import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, Loader, Upload, X } from 'lucide-react'
import { useT } from '~/lib/use-t'

interface DepositModalProps {
  open: boolean
  onClose: () => void
  amount: number
  onSuccess?: () => void
}

type UploadResponse = { url?: string; path?: string; error?: string }
type DepositResponse = { ok?: boolean; op?: string; error?: string }

type Step = 'qr' | 'slip'

const QR_SRC = '/images/qr-code.png'
const SLIP_EXAMPLE_SRC = '/images/payment-slip.jpg'

// Two-step deposit flow:
//  Step 1 — show the bank/wallet QR. Customer scans + pays externally.
//  Step 2 — customer uploads the resulting payment slip.
//           A small example slip is shown (click → fullscreen) until the
//           customer picks their own file. Once a file is chosen, it
//           auto-uploads to /api/payment-slip and the example is hidden.
//  After both: Confirm posts { op:deposit, amount, slipUrl } to /wallet,
//  creating a PENDING transaction.
export function DepositModal({ open, onClose, amount, onSuccess }: DepositModalProps) {
  const slipFetcher = useFetcher<UploadResponse>()
  const depositFetcher = useFetcher<DepositResponse>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const [step, setStep] = useState<Step>('qr')
  const [slipUrl, setSlipUrl] = useState('')
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [fileType, setFileType] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Tracks which depositFetcher.data we've already handled, so onSuccess +
  // onClose fire once per submission even when the parent re-renders (which
  // would otherwise change the inline-arrow prop refs and re-fire the effect).
  const handledDepositRef = useRef<DepositResponse | null>(null)

  const uploading = slipFetcher.state !== 'idle'
  const submitting = depositFetcher.state !== 'idle'

  // Reset on each open.
  useEffect(() => {
    if (!open) return
    setStep('qr')
    setSlipUrl('')
    setLocalPreview(null)
    setFileType('')
    setUploadError(null)
    setLightbox(null)
    handledDepositRef.current = null
  }, [open])

  // Adopt the CDN URL once the upload fetcher returns.
  useEffect(() => {
    if (slipFetcher.state !== 'idle' || !slipFetcher.data) return
    if (slipFetcher.data.error) {
      setUploadError(slipFetcher.data.error)
      return
    }
    if (slipFetcher.data.url) {
      setSlipUrl(slipFetcher.data.url)
      setUploadError(null)
    }
  }, [slipFetcher.state, slipFetcher.data])

  // Close + notify parent once the deposit action succeeds. The ref guard
  // makes this fire once per submission — without it, every parent re-render
  // gives `onSuccess`/`onClose` a fresh identity, re-firing the effect while
  // depositFetcher.data still holds the same { ok: true }.
  useEffect(() => {
    const data = depositFetcher.data
    if (depositFetcher.state !== 'idle' || !data) return
    if (handledDepositRef.current === data) return
    handledDepositRef.current = data
    if (data.ok) {
      onSuccess?.()
      onClose()
    }
  }, [depositFetcher.state, depositFetcher.data, onSuccess, onClose])

  // Revoke blob URLs we created.
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
      if (lightbox) {
        setLightbox(null)
      } else if (!submitting) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting, lightbox])

  if (!open) return null

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setFileType(file.type)
    // Immediate local preview.
    const preview = URL.createObjectURL(file)
    setLocalPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return preview
    })
    // Auto-upload
    const fd = new FormData()
    fd.append('file', file)
    slipFetcher.submit(fd, {
      method: 'post',
      action: '/api/payment-slip',
      encType: 'multipart/form-data',
    })
    e.target.value = ''  // allow re-selecting the same file
  }

  const userPickedFile = !!localPreview
  const displayedSlip = localPreview || slipUrl || null
  const isPdf = fileType === 'application/pdf' || slipUrl.endsWith('.pdf')

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
            aria-label={t('deposit.aria.close')}
          >
            <X size={18} />
          </button>

          <div className="mb-1 text-center text-xs font-bold " style={{ color: '#a78bfa' }}>
            {step === 'qr' ? t('deposit.step1') : t('deposit.step2')}
          </div>
          <h2 className="mb-1 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
            {amount.toLocaleString()} ₭
          </h2>

          {/* Step indicator dots */}
          <div className="mb-4 flex items-center justify-center gap-1.5">
            <span
              className="h-1.5 w-6 rounded-full transition-colors"
              style={{ background: step === 'qr' ? '#fde68a' : '#4c1d95' }}
            />
            <span
              className="h-1.5 w-6 rounded-full transition-colors"
              style={{ background: step === 'slip' ? '#fde68a' : '#4c1d95' }}
            />
          </div>

          {/* ─── Step 1: QR ──────────────────────────────────────────────── */}
          {step === 'qr' && (
            <>
              <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
                {t('deposit.qrInstruction')}
              </p>

              <div
                className="mb-4 flex justify-center rounded-xl px-4 py-5"
                style={{ background: '#1e0040', border: '1.5px solid #7c3aed' }}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(QR_SRC)}
                  className="block w-full max-w-[260px] overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                  style={{ border: '2px solid #a78bfa' }}
                  aria-label={t('deposit.aria.viewQr')}
                >
                  <img src={QR_SRC} alt="Payment QR code" className="block h-auto w-full object-contain" />
                </button>
              </div>

              <div className="w-full flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setStep('slip')}
                  className="flex w-auto items-center justify-center gap-2 rounded-lg py-2 px-4 text-sm font-bold  transition-opacity hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff',
                    boxShadow: '0 0 18px rgba(22,163,74,0.4)',
                  }}
                >
                  {t('common.next')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}

          {/* ─── Step 2: Upload slip ────────────────────────────────────── */}
          {step === 'slip' && (
            <>
              <p className="mb-4 text-center text-xs" style={{ color: '#c4b5fd' }}>
                {t('deposit.uploadInstruction')}
              </p>

              <div
                className="mb-4 flex flex-col items-center gap-3 rounded-xl px-4 py-5"
                style={{ background: '#1e0040', border: '1.5px dashed #7c3aed' }}
              >
                {/* Example payment-slip thumbnail — only shown until the user picks their own file. */}
                {!userPickedFile && (
                  <div className="flex w-full flex-col items-center gap-1.5">
                    <div className="text-[10px] font-bold " style={{ color: '#a78bfa' }}>
                      {t('deposit.example')}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLightbox(SLIP_EXAMPLE_SRC)}
                      className="block w-[120px] overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                      style={{ border: '1.5px solid #6d28d9' }}
                      aria-label={t('deposit.aria.viewExample')}
                    >
                      <img
                        src={SLIP_EXAMPLE_SRC}
                        alt="Example payment slip"
                        className="block h-auto w-full object-contain"
                      />
                    </button>
                    <div className="text-[10px]" style={{ color: '#7c3aed' }}>{t('deposit.tapForFull')}</div>
                  </div>
                )}

                {displayedSlip ? (
                  <div
                    className="relative w-full max-w-[260px] overflow-hidden rounded-lg"
                    style={{ border: '2px solid #a78bfa' }}
                  >
                    {isPdf ? (
                      <div
                        className="flex aspect-[4/3] items-center justify-center text-xs font-semibold"
                        style={{ background: '#2d1b4e', color: '#fde68a' }}
                      >
                        {t('deposit.pdfUploaded')}
                      </div>
                    ) : (
                      <img src={displayedSlip} alt="Payment slip preview" className="block h-auto w-full object-contain" />
                    )}
                    {uploading && (
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.5)' }}
                      >
                        <Loader size={24} className="animate-spin text-white" />
                      </div>
                    )}
                    {slipUrl && !uploading && (
                      <div
                        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
                        style={{ background: 'rgba(22,163,74,0.9)', color: '#fff' }}
                      >
                        <CheckCircle2 size={12} />
                        {t('deposit.uploaded')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 py-2 text-center">
                    <Camera size={32} style={{ color: '#a78bfa' }} />
                    <div className="text-sm font-semibold" style={{ color: '#c4b5fd' }}>
                      {t('deposit.tapToChooseSlip')}
                    </div>
                    <div className="text-[10px]" style={{ color: '#7c3aed' }}>
                      {t('deposit.fileTypes')}
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={onPickFile}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || submitting}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold  transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
                >
                  <Upload size={14} />
                  {slipUrl ? t('deposit.changeSlip') : t('common.chooseFile')}
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
              {depositFetcher.data?.error && (
                <div
                  className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
                >
                  {depositFetcher.data.error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('qr')}
                  disabled={submitting}
                  className="flex items-center justify-center gap-1 rounded-xl px-4 py-3 text-xs font-bold  transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: '#4c1d95', color: '#e9d5ff', border: '1.5px solid #7c3aed' }}
                >
                  <ArrowLeft size={14} />
                  {t('common.back')}
                </button>

                <depositFetcher.Form method="post" action="/wallet" className="flex flex-1">
                  <input type="hidden" name="op" value="deposit" />
                  <input type="hidden" name="amount" value={amount} />
                  <input type="hidden" name="slipUrl" value={slipUrl} />

                  <button
                    type="submit"
                    disabled={!slipUrl || uploading || submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold  transition-opacity disabled:opacity-40"
                    style={{
                      background: 'linear-gradient(135deg, #16a34a, #15803d)',
                      color: '#fff',
                      border: '2px solid #4ade80',
                      boxShadow: '0 0 18px rgba(22,163,74,0.4)',
                    }}
                  >
                    {submitting ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {submitting ? t('deposit.submitting') : t('deposit.confirmCta')}
                  </button>
                </depositFetcher.Form>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Lightbox for QR / example slip ─────────────────────────────
          Rendered as a sibling of the modal backdrop (not inside it) so that
          clicks on the lightbox don't bubble up and close the deposit modal. */}
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
          <img
            src={lightbox}
            alt="Full screen preview"
            className="max-h-full max-w-full object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
