import { useEffect } from 'react'
import { useFetcher } from 'react-router'
import { Loader, X } from 'lucide-react'

export type ConfirmTone = 'danger' | 'success' | 'neutral'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  tone?: ConfirmTone
  confirmLabel: string
  /** Hidden form fields submitted to the parent route's action. */
  fields: Record<string, string>
  /** Form method (defaults to "post"). */
  method?: 'post' | 'put' | 'delete'
  /** Optional explicit action URL — defaults to the current route. */
  action?: string
  /** Called with `true` once the action returns `{ ok: true }`. */
  onSettled?: (ok: boolean) => void
}

const TONE_STYLES: Record<ConfirmTone, { bg: string; border: string; color: string }> = {
  danger: { bg: 'linear-gradient(135deg, #7f1d1d, #4c0519)', border: '#fca5a5', color: '#fff' },
  success: { bg: 'linear-gradient(135deg, #14532d, #052e16)', border: '#4ade80', color: '#fff' },
  neutral: { bg: 'linear-gradient(135deg, #4338ca, #1e1b4b)', border: '#818cf8', color: '#fff' },
}

// Generic confirm dialog used by admin actions (approve/reject deposits,
// suspend/activate customers, etc.). Submits via useFetcher so the page
// stays mounted; on success the loader revalidates and the row updates.
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  tone = 'neutral',
  confirmLabel,
  fields,
  method = 'post',
  action,
  onSettled,
}: ConfirmDialogProps) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const submitting = fetcher.state !== 'idle'
  const toneStyle = TONE_STYLES[tone]

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  // Close + notify when the action settles successfully.
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return
    if (fetcher.data.ok) {
      onSettled?.(true)
      onClose()
    }
  }, [fetcher.state, fetcher.data, onSettled, onClose])

  if (!open) return null

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
          'relative w-full p-5',
          'rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          'animate-in slide-in-from-bottom duration-200',
          'md:max-w-sm md:rounded-xl md:pb-5 md:fade-in md:zoom-in-95',
        ].join(' ')}
        style={{
          background: 'linear-gradient(135deg, #1e1b4b, #0f172a)',
          border: '1px solid #4338ca',
          boxShadow: '0 10px 60px rgba(0,0,0,0.7)',
        }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full md:hidden" style={{ background: '#4338ca' }} />

        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80 disabled:opacity-30"
          style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc' }}
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <h3 className="mb-1 text-base font-bold" style={{ color: '#fde68a' }}>{title}</h3>
        {description && (
          <p className="mb-4 text-xs" style={{ color: '#a5b4fc' }}>{description}</p>
        )}

        {fetcher.data?.error && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
          >
            {fetcher.data.error}
          </div>
        )}

        <fetcher.Form method={method} action={action} className="flex items-center justify-end gap-2">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-xs font-bold tracking-widest disabled:opacity-50"
            style={{ background: 'transparent', color: '#a5b4fc', border: '1px solid #4338ca' }}
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold tracking-widest disabled:opacity-50"
            style={{ background: toneStyle.bg, color: toneStyle.color, border: `1px solid ${toneStyle.border}` }}
          >
            {submitting && <Loader size={12} className="animate-spin" />}
            {confirmLabel}
          </button>
        </fetcher.Form>
      </div>
    </div>
  )
}
