import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, Loader, Pencil, Upload, X } from 'lucide-react'
import { useT } from '~/lib/use-t'

interface WithdrawModalProps {
  open: boolean
  onClose: () => void
  amount: number
  /** Customer's existing bank QR URL, if any. When set, the modal opens at the
   *  confirm step (skipping the upload step). User can still tap "change" to
   *  replace the QR. */
  existingBankQrUrl: string | null
  onSuccess?: () => void
}

type UploadResponse = { url?: string; qrUrl?: string; error?: string }
type WithdrawResponse = { ok?: boolean; op?: string; error?: string }

type Step = 'qr' | 'confirm'

// Withdraw flow:
//  - If the user has no bank QR yet → step 1 (upload). Auto-advances to confirm
//    when the QR upload returns a URL.
//  - If the user already has a bank QR → opens directly at the confirm step.
//    They can still tap "change QR" to replace it.
//  After confirm: posts { op:withdraw, amount } to /wallet which creates a
//  PENDING transaction. The wallet is debited only when an admin approves.
export function WithdrawModal({ open, onClose, amount, existingBankQrUrl, onSuccess }: WithdrawModalProps) {
  const qrFetcher = useFetcher<UploadResponse>()
  const withdrawFetcher = useFetcher<WithdrawResponse>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  // currentQr starts as the prop value (server-known URL); each successful
  // upload overwrites it. Confirm step is allowed iff this is non-empty.
  const [currentQr, setCurrentQr] = useState<string | null>(existingBankQrUrl)
  const [step, setStep] = useState<Step>(existingBankQrUrl ? 'confirm' : 'qr')
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const handledWithdrawRef = useRef<WithdrawResponse | null>(null)

  const uploading = qrFetcher.state !== 'idle'
  const submitting = withdrawFetcher.state !== 'idle'

  // Reset on each open — pull in the latest prop value.
  useEffect(() => {
    if (!open) return
    setCurrentQr(existingBankQrUrl)
    setStep(existingBankQrUrl ? 'confirm' : 'qr')
    setLocalPreview(null)
    setUploadError(null)
    setLightbox(null)
    handledWithdrawRef.current = null
  }, [open, existingBankQrUrl])

  // Adopt the CDN URL once the upload fetcher returns + auto-advance.
  useEffect(() => {
    if (qrFetcher.state !== 'idle' || !qrFetcher.data) return
    if (qrFetcher.data.error) {
      setUploadError(qrFetcher.data.error)
      return
    }
    const url = qrFetcher.data.qrUrl ?? qrFetcher.data.url
    if (url) {
      setCurrentQr(url)
      setUploadError(null)
      setStep('confirm')
    }
  }, [qrFetcher.state, qrFetcher.data])

  // Close + notify once the withdraw action succeeds — guarded so the parent's
  // re-renders don't refire the toast/onClose on the same response.
  useEffect(() => {
    const data = withdrawFetcher.data
    if (withdrawFetcher.state !== 'idle' || !data) return
    if (handledWithdrawRef.current === data) return
    handledWithdrawRef.current = data
    if (data.ok) {
      onSuccess?.()
      onClose()
    }
  }, [withdrawFetcher.state, withdrawFetcher.data, onSuccess, onClose])

  // Revoke blob URLs.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  // Esc closes the lightbox first, then the modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (lightbox) setLightbox(null)
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting, lightbox])

  if (!open) return null

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    const preview = URL.createObjectURL(file)
    setLocalPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return preview
    })
    const fd = new FormData()
    fd.append('file', file)
    qrFetcher.submit(fd, {
      method: 'post',
      action: '/api/bank-qr',
      encType: 'multipart/form-data',
    })
    e.target.value = ''
  }

  const previewSrc = localPreview || currentQr || null

  return (
    <>
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
            aria-label={t('withdraw.aria.close')}
          >
            <X size={18} />
          </button>

          <div className="mb-1 text-center text-xs font-bold " style={{ color: '#a78bfa' }}>
            {step === 'qr' ? t('withdraw.step1') : currentQr && existingBankQrUrl ? t('withdraw.confirmTitle') : t('withdraw.step2')}
          </div>
          <h2 className="mb-4 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
            {amount.toLocaleString()} ₭
          </h2>

          {/* ─── Step 1 — bank QR upload ──────────────────────────── */}
          {step === 'qr' && (
            <>
              <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
                {t('withdraw.qrInstruction')}
              </p>

              <div
                className="mb-4 flex flex-col items-center gap-3 rounded-xl px-4 py-5"
                style={{ background: '#1e0040', border: '1.5px dashed #7c3aed' }}
              >
                {previewSrc ? (
                  <div
                    className="relative w-full max-w-[240px] overflow-hidden rounded-lg"
                    style={{ border: '2px solid #a78bfa' }}
                  >
                    <img src={previewSrc} alt="Bank QR preview" className="block h-auto w-full object-contain" />
                    {uploading && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                        <Loader size={24} className="animate-spin text-white" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 py-6 text-center">
                    <Camera size={36} style={{ color: '#a78bfa' }} />
                    <div className="text-sm font-semibold" style={{ color: '#c4b5fd' }}>{t('withdraw.tapToUpload')}</div>
                    <div className="text-[10px]" style={{ color: '#7c3aed' }}>{t('withdraw.fileTypes')}</div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onPickFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold  transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
                >
                  <Upload size={14} />
                  {currentQr ? t('withdraw.changeQr') : t('common.chooseFile')}
                </button>
              </div>

              {uploadError && (
                <div
                  className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
                >
                  {uploadError}
                </div>
              )}
            </>
          )}

          {/* ─── Step 2 — confirm ─────────────────────────────────── */}
          {step === 'confirm' && currentQr && (
            <>
              <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
                {t('withdraw.confirmInstruction')}
              </p>

              <div
                className="mb-4 flex flex-col items-center gap-3 rounded-xl px-4 py-5"
                style={{ background: '#1e0040', border: '1.5px solid #7c3aed' }}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(currentQr)}
                  className="block w-full max-w-[240px] overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                  style={{ border: '2px solid #a78bfa' }}
                  aria-label={t('withdraw.aria.viewQr')}
                >
                  <img src={currentQr} alt="Bank QR" className="block h-auto w-full object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => setStep('qr')}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold  transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
                >
                  <Pencil size={10} />
                  {t('withdraw.changeQr')}
                </button>
              </div>

              {withdrawFetcher.data?.error && (
                <div
                  className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
                >
                  {withdrawFetcher.data.error}
                </div>
              )}

              <withdrawFetcher.Form method="post" action="/wallet" className="flex flex-col gap-3">
                <input type="hidden" name="op" value="withdraw" />
                <input type="hidden" name="amount" value={amount} />

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold  transition-opacity disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #b45309, #78350f)',
                    color: '#fff',
                    border: '2px solid #fcd34d',
                    boxShadow: '0 0 18px rgba(180,83,9,0.4)',
                  }}
                >
                  {submitting ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {submitting ? t('deposit.submitting') : t('withdraw.confirmCta')}
                </button>
              </withdrawFetcher.Form>
            </>
          )}

          {/* Step nav — only shown on QR step when a QR already exists. */}
          {step === 'qr' && currentQr && (
            <button
              type="button"
              onClick={() => setStep('confirm')}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-bold "
              style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
            >
              {t('withdraw.keepCurrentQr')}
              <ArrowRight size={14} />
            </button>
          )}
          {step === 'confirm' && !existingBankQrUrl && (
            <button
              type="button"
              onClick={() => setStep('qr')}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-bold "
              style={{ background: 'transparent', color: '#c4b5fd', border: '1px solid #4c1d95' }}
            >
              <ArrowLeft size={14} />
              {t('common.back')}
            </button>
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={e => { e.stopPropagation(); setLightbox(null) }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setLightbox(null) }}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#e9d5ff' }}
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
          <img src={lightbox} alt="Bank QR preview" className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
