import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { CheckCircle2, KeyRound, Loader, X } from 'lucide-react'
import { useT } from '~/lib/use-t'

interface ClaimTransferModalProps {
  open: boolean
  onClose: () => void
  /** Transfer being claimed. */
  transfer: {
    id: string
    amount: number
    sender: { tel: string; name: string | null }
  } | null
  onSuccess?: () => void
}

type SubmitResp = { ok?: boolean; op?: string; error?: string }

// Receiver-side modal: enter the 6-digit code shared by the sender to claim
// a locked transfer. After 5 wrong attempts the server flips the transfer
// to LOCKED and the sender has to cancel + resend.
export function ClaimTransferModal({ open, onClose, transfer, onSuccess }: ClaimTransferModalProps) {
  const t = useT()
  const fetcher = useFetcher<SubmitResp>()
  const handledRef = useRef<SubmitResp | null>(null)
  const [code, setCode] = useState('')

  const submitting = fetcher.state !== 'idle'

  useEffect(() => {
    if (!open) return
    setCode('')
    handledRef.current = null
  }, [open, transfer?.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  useEffect(() => {
    const data = fetcher.data
    if (fetcher.state !== 'idle' || !data) return
    if (handledRef.current === data) return
    handledRef.current = data
    if (data.ok) {
      onSuccess?.()
      onClose()
    }
  }, [fetcher.state, fetcher.data, onSuccess, onClose])

  if (!open || !transfer) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) return
    const fd = new FormData()
    fd.append('op', 'claimTransfer')
    fd.append('transferId', transfer!.id)
    fd.append('code', code)
    fetcher.submit(fd, { method: 'post', action: '/wallet' })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 backdrop-blur-sm md:items-center md:p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={submitting ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        className={[
          'relative w-full p-6',
          'rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'animate-in slide-in-from-bottom duration-300',
          'md:max-w-sm md:rounded-xl md:pb-6 md:fade-in md:zoom-in-95',
        ].join(' ')}
        style={{
          background: 'linear-gradient(135deg, #4c1d95, #1e0040)',
          boxShadow: '0 10px 60px rgba(0,0,0,0.7)',
        }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full md:hidden" style={{ background: '#7c3aed' }} />

        <button
          onClick={onClose}
          type="button"
          disabled={submitting}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80 disabled:opacity-30"
          style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#e9d5ff' }}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        <div className="mb-1 text-center text-xs font-bold " style={{ color: '#a78bfa' }}>
          {t('transfer.claimTitle')}
        </div>
        <h2 className="mb-1 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
          {transfer.amount.toLocaleString()} ₭
        </h2>
        <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
          {t('transfer.claimDesc', { sender: transfer.sender.name ?? transfer.sender.tel })}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-[10px] font-bold " style={{ color: '#a78bfa' }}>
            {t('transfer.code')}
          </label>
          <div className="relative">
            <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a78bfa' }} />
            <input
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="w-full rounded-lg py-2.5 pl-9 pr-3 text-lg font-bold tracking-[0.5em] outline-none"
              style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed', textAlign: 'center' }}
            />
          </div>

          {fetcher.data?.error && (
            <div className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
              {fetcher.data.error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold  transition-opacity disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff',
              border: '2px solid #4ade80',
              boxShadow: '0 0 18px rgba(22,163,74,0.4)',
            }}
          >
            {submitting ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {submitting ? t('deposit.submitting') : t('transfer.claimCta')}
          </button>
        </form>
      </div>
    </div>
  )
}
