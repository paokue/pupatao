// Server-only Gmail SMTP notifier. Sends a plain transactional email to the
// admin inbox whenever a customer triggers an event we want them to see
// (registration, deposit, withdraw, transfer).
//
// Mirrors the fire-and-forget pattern used in `pusher.server.ts`: a missing or
// broken SMTP config is logged, never thrown — we don't want a Gmail outage to
// fail a customer's deposit submission.

import type Nodemailer from 'nodemailer'

// Hardcoded recipient per product spec. Override per-deploy by setting
// ADMIN_NOTIFY_EMAIL if you ever need to redirect.
const DEFAULT_ADMIN_EMAIL = 'kuvthiabkoj2024@gmail.com'

let _transporter: Nodemailer.Transporter | null = null
let _initFailed = false

async function transporter(): Promise<Nodemailer.Transporter | null> {
  if (_transporter) return _transporter
  if (_initFailed) return null

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[mail] SMTP env vars missing — admin notifications disabled.')
    _initFailed = true
    return null
  }

  try {
    const nodemailer = await import('nodemailer')
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
    return _transporter
  } catch (err) {
    console.error('[mail] failed to init SMTP transporter', err)
    _initFailed = true
    return null
  }
}

interface AdminMailInput {
  subject: string
  // Either an HTML body or a list of plain "Label: value" lines.
  // Lines are rendered as a simple <ul> for readability in Gmail.
  lines?: { label: string; value: string }[]
  intro?: string
}

// Fire-and-forget admin notification. Caller can await for back-pressure but
// we never throw, so a missing/broken transporter just logs and resolves.
export async function notifyAdminByEmail(input: AdminMailInput): Promise<void> {
  const tx = await transporter()
  if (!tx) return

  const to = process.env.ADMIN_NOTIFY_EMAIL || DEFAULT_ADMIN_EMAIL
  const from = process.env.MAIL_FROM || `Pupatao <${process.env.SMTP_USER}>`

  const itemsHtml = (input.lines ?? [])
    .map(l => `<li><strong>${escapeHtml(l.label)}:</strong> ${escapeHtml(l.value)}</li>`)
    .join('')

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;color:#4338ca;">${escapeHtml(input.subject)}</h2>
      ${input.intro ? `<p style="margin:0 0 12px;">${escapeHtml(input.intro)}</p>` : ''}
      ${itemsHtml ? `<ul style="margin:0 0 12px 18px;padding:0;">${itemsHtml}</ul>` : ''}
      <p style="margin:16px 0 0;font-size:12px;color:#666;">
        Sent by Pupatao at ${new Date().toLocaleString()}
      </p>
    </div>
  `

  const text = [
    input.subject,
    '',
    input.intro ?? '',
    ...(input.lines ?? []).map(l => `${l.label}: ${l.value}`),
  ].filter(Boolean).join('\n')

  try {
    await tx.sendMail({ from, to, subject: `[Pupatao] ${input.subject}`, text, html })
  } catch (err) {
    console.error('[mail] sendMail failed', err)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
