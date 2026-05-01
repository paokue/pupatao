import { useEffect, useState } from 'react'
import { Copy, Check, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useT } from '~/lib/use-t'

export type ReferralListItem = {
  id: string
  tel: string
  name: string | null
  joinedAt: string
  bonusPaid: boolean
}

// Modal opened from the avatar card on /profile. Shows the referral pitch,
// the share URL, a copy button, a QR code generated from the link, and the
// list of users this player has invited (with bonus-paid status per referee).
export function ReferralModal({
  open,
  onClose,
  shareUrl,
  code,
  referrals,
}: {
  open: boolean
  onClose: () => void
  shareUrl: string
  code: string
  referrals: ReferralListItem[]
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  // Auto-clear the "copied" feedback after a moment.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(id)
  }, [copied])

  // Reset copied state whenever the modal opens fresh.
  useEffect(() => {
    if (open) setCopied(false)
  }, [open])

  if (!open) return null

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
    } catch {
      // Older Safari + insecure contexts: fall back to a temp textarea.
      const ta = document.createElement('textarea')
      ta.value = shareUrl
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true) } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,0,32,0.85)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, #3b0764, #1e0040)',
          border: '1px solid #a78bfa',
          boxShadow: '0 10px 40px rgba(124,58,237,0.5)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="mb-1 text-center text-lg font-bold " style={{ color: '#fde68a' }}>
          {t('referral.title')}
        </div>
        <p className="mb-5 text-center text-xs" style={{ color: '#c4b5fd' }}>
          {t('referral.description')}
        </p>

        {/* QR code — uses brand-friendly colors against a white tile so it
            scans cleanly on any phone camera. */}
        <div className="mx-auto mb-5 flex h-44 w-44 items-center justify-center rounded-xl bg-white p-2.5">
          <QRCodeSVG
            value={shareUrl}
            size={160}
            level="M"
            bgColor="#ffffff"
            fgColor="#1e0040"
          />
        </div>

        {/* Code chip — shown above the link as a fallback for typed entry. */}
        <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-bold " style={{ color: '#a78bfa' }}>
          <span>{t('referral.codeLabel')}</span>
          <span className="rounded-md px-2 py-0.5 text-sm" style={{ background: '#2d1b4e', color: '#fde68a', border: '1px solid #4c1d95' }}>
            {code}
          </span>
        </div>

        {/* Share URL + copy button. */}
        <div
          className="flex items-stretch gap-2 rounded-xl p-1.5"
          style={{ background: '#1a0630', border: '1.5px solid #4c1d95' }}
        >
          <input
            readOnly
            value={shareUrl}
            onFocus={e => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs outline-none"
            style={{ color: '#e9d5ff' }}
            aria-label={t('referral.linkAria')}
          />
          <button
            type="button"
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-bold  transition-opacity hover:opacity-90"
            style={{ background: copied ? '#16a34a' : '#7c3aed', color: '#fff', border: `1px solid ${copied ? '#4ade80' : '#a78bfa'}` }}
            aria-label={t('referral.copy')}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('referral.copied') : t('referral.copy')}
          </button>
        </div>

        {/* ─── Referrals list ─────────────────────────────────────────── */}
        <div className="mt-5">
          <ReferralsList referrals={referrals} />
        </div>
      </div>
    </div>
  )
}

// Reusable referrals list — used inside this modal and on the profile page
// just below the bank-QR section. `bonusPaid` is true once admin has
// approved the referee's first deposit (which auto-credits the inviter
// +10,000 ₭ on their REAL wallet).
export function ReferralsList({ referrals }: { referrals: ReferralListItem[] }) {
  const t = useT()
  return (
    <>
      <div className="mb-2 flex items-center justify-between text-[10px] font-bold " style={{ color: '#a78bfa' }}>
        <span>{t('referral.yourReferrals')}</span>
        <span
          className="rounded-full px-2 py-0.5"
          style={{ background: '#2d1b4e', color: '#fde68a', border: '1px solid #4c1d95' }}
        >
          {referrals.length}
        </span>
      </div>

      {referrals.length === 0 ? (
        <div
          className="rounded-xl py-4 text-center text-xs"
          style={{ background: '#1a0630', border: '1px dashed #4c1d95', color: '#a78bfa' }}
        >
          {t('referral.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {referrals.map(r => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: '#1a0630', border: '1px solid #4c1d95' }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold" style={{ color: '#e9d5ff' }}>
                  {r.name ?? r.tel}
                </div>
                <div className="text-[10px]" style={{ color: '#a78bfa' }}>
                  {r.name ? `${r.tel} · ` : ''}{new Date(r.joinedAt).toLocaleDateString()}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold "
                style={
                  r.bonusPaid
                    ? { background: 'rgba(22,163,74,0.25)', color: '#4ade80', border: '1px solid #4ade80' }
                    : { background: 'rgba(234,179,8,0.18)', color: '#fde68a', border: '1px solid #fbbf24' }
                }
              >
                {r.bonusPaid ? t('referral.bonusPaid') : t('referral.pending')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
