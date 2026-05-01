// Referral-code helpers (server-only).
//
// Codes are 8-char URL-safe alphanumeric strings. The alphabet excludes
// visually-ambiguous characters (0/O/I/L/1) so codes typed by hand from a QR
// or shared message are less error-prone. Collision space is 32^8 ≈ 1.1e12 —
// generation collisions are vanishingly unlikely, but we still retry on the
// off-chance to keep the unique constraint happy.

import { randomBytes } from 'node:crypto'
import { prisma } from './prisma.server'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateReferralCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    })
    if (!existing) return code
  }
  throw new Error('Could not generate a unique referral code after 5 attempts')
}

// Resolves a `?ref=CODE` query value to the referrer's user id, or returns
// null if the code is missing / invalid / matches no user. Never throws —
// signup must continue even if the code is bogus.
export async function resolveReferralCode(rawCode: string | null | undefined): Promise<string | null> {
  if (!rawCode) return null
  const code = rawCode.trim().toUpperCase()
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return null
  try {
    const ref = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true, status: true },
    })
    if (!ref) return null
    if (ref.status !== 'ACTIVE') return null  // ignore suspended/banned referrers
    return ref.id
  } catch (err) {
    console.error('[referral] resolve failed', err)
    return null
  }
}

// Public-facing share URL. Reads from a runtime env so production points at
// the prod hostname (e.g. https://pupatao.la) while dev / preview / local
// fall back to the request's origin.
export function buildReferralShareUrl(req: Request, code: string): string {
  const explicit = process.env.PUBLIC_BASE_URL
  if (explicit) return `${explicit.replace(/\/+$/, '')}/register?ref=${code}`
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}/register?ref=${code}`
}
