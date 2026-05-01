import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { ArrowLeft, ArrowRight, CheckCircle2, Dice5, KeyRound, Loader, Lock, Phone, Search, Unlock, X } from 'lucide-react'
import { useT } from '~/lib/use-t'

interface TransferModalProps {
  open: boolean
  onClose: () => void
  /** Pre-selected amount in ₭ (validated by the wallet route's loader/action). */
  amount: number
  /** Current sender's tel — used to block self-transfers client-side. */
  senderTel: string
  onSuccess?: () => void
}

type LookupResp = {
  found?: boolean
  isSelf?: boolean
  isInactive?: boolean
  user?: { tel: string; firstName: string | null; lastName: string | null }
  error?: string
}
type SubmitResp = { ok?: boolean; op?: string; error?: string }

type Method = 'general' | 'locked'
type Step = 'form' | 'confirm'

function randomCode(): string {
  // 6 digits, leading zeros allowed.
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

export function TransferModal({ open, onClose, amount, senderTel, onSuccess }: TransferModalProps) {
  const t = useT()
  const lookupFetcher = useFetcher<LookupResp>()
  const submitFetcher = useFetcher<SubmitResp>()
  const handledRef = useRef<SubmitResp | null>(null)

  const [step, setStep] = useState<Step>('form')
  const [method, setMethod] = useState<Method>('general')
  const [tel, setTel] = useState('')
  const [code, setCode] = useState(randomCode())
  const [codeMode, setCodeMode] = useState<'random' | 'manual'>('random')
  const [error, setError] = useState<string | null>(null)

  const submitting = submitFetcher.state !== 'idle'
  const looking = lookupFetcher.state !== 'idle'
  const recipient = lookupFetcher.data?.user

  useEffect(() => {
    if (!open) return
    setStep('form')
    setMethod('general')
    setTel('')
    setCode(randomCode())
    setCodeMode('random')
    setError(null)
    handledRef.current = null
  }, [open])

  // Esc closes modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  // Adopt success — fire once per fetcher response.
  useEffect(() => {
    const data = submitFetcher.data
    if (submitFetcher.state !== 'idle' || !data) return
    if (handledRef.current === data) return
    handledRef.current = data
    if (data.ok) {
      onSuccess?.()
      onClose()
    } else if (data.error) {
      setError(data.error)
    }
  }, [submitFetcher.state, submitFetcher.data, onSuccess, onClose])

  if (!open) return null

  function lookup() {
    if (!tel.trim()) return
    setError(null)
    const fd = new FormData()
    fd.append('tel', tel.trim())
    lookupFetcher.submit(fd, { method: 'post', action: '/api/lookup-tel' })
  }

  function nextToConfirm() {
    setError(null)
    const cleanTel = tel.trim()
    if (!cleanTel) { setError(t('transfer.errPhone')); return }
    if (cleanTel === senderTel) { setError(t('transfer.errSelf')); return }
    if (!recipient && !lookupFetcher.data?.found) { setError(t('transfer.errLookupFirst')); return }
    if (lookupFetcher.data?.isSelf) { setError(t('transfer.errSelf')); return }
    if (lookupFetcher.data?.isInactive) { setError(t('transfer.errInactive')); return }
    if (!recipient) { setError(t('transfer.errLookupFirst')); return }
    if (method === 'locked' && !/^\d{6}$/.test(code)) { setError(t('transfer.errCode')); return }
    setStep('confirm')
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.append('op', method === 'general' ? 'transferGeneral' : 'transferLocked')
    fd.append('amount', String(amount))
    fd.append('recipientTel', tel.trim())
    if (method === 'locked') fd.append('code', code)
    submitFetcher.submit(fd, { method: 'post', action: '/wallet' })
  }

  const recipientName = recipient
    ? [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || recipient.tel
    : null

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
          'relative w-full overflow-y-auto p-6',
          'h-[85vh] max-h-[85vh] rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'animate-in slide-in-from-bottom duration-300',
          'md:h-auto md:max-h-[90vh] md:max-w-md md:rounded-xl md:pb-6 md:animate-in md:fade-in md:zoom-in-95 md:duration-200',
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
          {step === 'form' ? t('transfer.title') : t('transfer.confirmTitle')}
        </div>
        <h2 className="mb-4 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
          {amount.toLocaleString()} ₭
        </h2>

        {step === 'form' && (
          <>
            {/* Method toggle */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              {(['general', 'locked'] as Method[]).map(m => {
                const active = method === m
                const Icon = m === 'general' ? Unlock : Lock
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className="flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold  transition-opacity hover:opacity-90"
                    style={{
                      background: active ? '#7c3aed' : '#1e0040',
                      color: active ? '#fff' : '#a78bfa',
                      border: `1.5px solid ${active ? '#a78bfa' : '#4c1d95'}`,
                    }}
                  >
                    <Icon size={12} />
                    {m === 'general' ? t('transfer.methodGeneral') : t('transfer.methodLocked')}
                  </button>
                )
              })}
            </div>

            {/* Recipient phone */}
            <label className="mb-1 block text-[10px] font-bold " style={{ color: '#a78bfa' }}>
              {t('transfer.recipient')}
            </label>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Phone size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a78bfa' }} />
                <input
                  value={tel}
                  onChange={e => { setTel(e.target.value); setError(null) }}
                  type="tel"
                  inputMode="tel"
                  placeholder="+85620xxxxxxxx"
                  className="w-full rounded-lg py-2 pl-9 pr-3 text-sm font-semibold outline-none"
                  style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed' }}
                />
              </div>
              <button
                type="button"
                onClick={lookup}
                disabled={!tel.trim() || looking}
                className="rounded-lg px-3 py-2 text-xs font-bold  disabled:opacity-50"
                style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
              >
                {looking ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
              </button>
            </div>

            {/* Lookup preview */}
            {lookupFetcher.data && !lookupFetcher.data.error && (
              <div className="mb-3">
                {lookupFetcher.data.isSelf ? (
                  <div className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
                    {t('transfer.errSelf')}
                  </div>
                ) : lookupFetcher.data.isInactive ? (
                  <div className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
                    {t('transfer.errInactive')}
                  </div>
                ) : lookupFetcher.data.found && recipient ? (
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: '#1e0040', border: '1px solid #4ade80' }}>
                    <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'linear-gradient(135deg, #f59e0b, #b45309)', color: '#1e0040' }}>
                      {(recipient.firstName?.[0] ?? '') + (recipient.lastName?.[0] ?? '') || recipient.tel.slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold" style={{ color: '#fde68a' }}>{recipientName}</div>
                      <div className="text-xs" style={{ color: '#a78bfa' }}>{recipient.tel}</div>
                    </div>
                    <CheckCircle2 size={18} style={{ color: '#4ade80' }} />
                  </div>
                ) : (
                  <div className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
                    {t('transfer.errNotFound')}
                  </div>
                )}
              </div>
            )}

            {/* Locked-method code field */}
            {method === 'locked' && (
              <>
                <label className="mb-1 mt-1 block text-[10px] font-bold " style={{ color: '#a78bfa' }}>
                  {t('transfer.code')}
                </label>

                {/* Manual / Random toggle */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {(['random', 'manual'] as const).map(m => {
                    const active = codeMode === m
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setCodeMode(m)
                          if (m === 'random') setCode(randomCode())
                        }}
                        className="rounded-md py-1.5 text-[10px] font-bold "
                        style={{
                          background: active ? '#1e0040' : 'transparent',
                          color: active ? '#fde68a' : '#7c3aed',
                          border: `1px solid ${active ? '#a78bfa' : '#4c1d95'}`,
                        }}
                      >
                        {m === 'random' ? t('transfer.codeRandom') : t('transfer.codeManual')}
                      </button>
                    )
                  })}
                </div>

                <div className="mb-1 flex gap-2">
                  <div className="relative flex-1">
                    <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a78bfa' }} />
                    <input
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      readOnly={codeMode === 'random'}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      className="w-full rounded-lg py-2 pl-9 pr-3 text-base font-bold tracking-[0.5em] outline-none"
                      style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed', textAlign: 'center' }}
                    />
                  </div>
                  {codeMode === 'random' && (
                    <button
                      type="button"
                      onClick={() => setCode(randomCode())}
                      className="flex items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-bold  hover:opacity-90"
                      style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
                      title={t('transfer.regenerate')}
                    >
                      <Dice5 size={14} />
                    </button>
                  )}
                </div>
                <p className="mb-3 text-[10px]" style={{ color: '#7c3aed' }}>
                  {t('transfer.codeHint')}
                </p>
              </>
            )}

            {error && (
              <div className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={nextToConfirm}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold  transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                border: '2px solid #4ade80',
                boxShadow: '0 0 18px rgba(22,163,74,0.4)',
              }}
            >
              {t('common.next')}
              <ArrowRight size={16} />
            </button>
          </>
        )}

        {step === 'confirm' && recipient && (
          <>
            <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
              {method === 'general' ? t('transfer.confirmGeneralDesc') : t('transfer.confirmLockedDesc')}
            </p>

            <div className="mb-4 flex flex-col gap-2 rounded-xl px-4 py-3" style={{ background: '#1e0040', border: '1px solid #4c1d95' }}>
              <Row label={t('transfer.recipient')} value={recipientName ?? recipient.tel} />
              <Row label={t('auth.phone')} value={recipient.tel} mono />
              <Row label={t('wallet.tab.transfer')} value={`${amount.toLocaleString()} ₭`} highlight />
              <Row label={t('transfer.method')} value={method === 'general' ? t('transfer.methodGeneral') : t('transfer.methodLocked')} />
              {method === 'locked' && (
                <Row label={t('transfer.code')} value={code} mono highlight />
              )}
            </div>

            {method === 'locked' && (
              <div className="mb-4 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(234,179,8,0.15)', color: '#fde68a', border: '1px solid #fbbf24' }}>
                {t('transfer.shareCodeWarning')}
              </div>
            )}

            {error && (
              <div className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}>
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={submitting}
                className="flex items-center gap-1 rounded-xl px-4 py-3 text-xs font-bold  hover:opacity-90 disabled:opacity-40"
                style={{ background: '#4c1d95', color: '#e9d5ff', border: '1.5px solid #7c3aed' }}
              >
                <ArrowLeft size={14} />
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold  disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  border: '2px solid #4ade80',
                  boxShadow: '0 0 18px rgba(22,163,74,0.4)',
                }}
              >
                {submitting ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {submitting ? t('deposit.submitting') : t('transfer.confirmCta')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span style={{ color: '#a78bfa' }}>{label}</span>
      <span
        className={mono ? 'font-mono' : 'font-bold'}
        style={{ color: highlight ? '#fde68a' : '#e9d5ff' }}
      >
        {value}
      </span>
    </div>
  )
}
