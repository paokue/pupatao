import { useEffect } from 'react'
import { useFetcher } from 'react-router'
import { Loader, UserRoundPlus, X } from 'lucide-react'
import { PasswordInput } from './PasswordInput'
import { useT } from '~/lib/use-t'

interface RegisterModalProps {
  open: boolean
  onClose: () => void
  /** Path to return to after successful registration (defaults to current page). */
  next?: string
  /** Optional reason shown above the form. */
  hint?: string
  /** Called when the user clicks "Sign In" — swap to the login modal in-place. */
  onSwitchToLogin?: () => void
}

// Overlay sign-up modal. Matches LoginModal styling — bottom sheet on mobile,
// centred card on desktop. Submits to the `/register` action via a fetcher so
// the current page stays mounted; on success the session cookie is set and
// the root loader revalidates, after which the caller closes the modal.
export function RegisterModal({ open, onClose, next, hint, onSwitchToLogin }: RegisterModalProps) {
  const fetcher = useFetcher<{ error?: string } | null>()
  const submitting = fetcher.state !== 'idle'
  const t = useT()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const nextPath = next ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 backdrop-blur-sm md:items-center md:p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        className={[
          'relative w-full overflow-y-auto p-6',
          'h-[80vh] max-h-[80vh] rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'animate-in slide-in-from-bottom duration-300',
          'md:h-auto md:max-h-[90vh] md:w-full md:max-w-md md:rounded-2xl md:pb-6 md:animate-in md:fade-in md:zoom-in-95 md:duration-200',
        ].join(' ')}
        style={{
          background: 'linear-gradient(135deg, #4c1d95, #1e0040)',
          boxShadow: '0 10px 60px rgba(0,0,0,0.7)',
        }}
      >
        {/* Drag-handle affordance on mobile */}
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 rounded-full md:hidden"
          style={{ background: '#7c3aed' }}
        />

        {/* Close button — top-right on all breakpoints */}
        <button
          onClick={onClose}
          type="button"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#e9d5ff' }}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        <div className="mb-1 text-center text-xs font-bold tracking-widest" style={{ color: '#a78bfa' }}>
          {t('auth.titleRegister')}
        </div>
        <h2 className="mb-1 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
          {t('auth.createAccount')}
        </h2>
        <p className="mb-4 text-center text-[11px]" style={{ color: '#c4b5fd' }}>
          {hint ?? t('auth.registerHint')}
        </p>

        <fetcher.Form method="post" action="/register" className="flex flex-col gap-3">
          <input type="hidden" name="next" value={nextPath} />

          <label className="flex gap-1 text-xs font-semibold" style={{ color: '#c4b5fd' }}>
            {t('auth.phone')} <span className='text-rose-500'>*</span>
          </label>
          <input
            name="tel"
            type="tel"
            autoComplete="tel"
            required
            placeholder="+85620xxxxxxxx"
            className="rounded-lg px-3 py-2.5 text-sm font-semibold outline-none"
            style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed' }}
          />

          <label className="flex gap-1 text-xs font-semibold" style={{ color: '#c4b5fd' }}>
            {t('auth.password')} <span className='text-rose-500'>*</span>
          </label>
          <PasswordInput name="password" autoComplete="new-password" required minLength={6} />

          <label className="flex gap-1 text-xs font-semibold" style={{ color: '#c4b5fd' }}>
            {t('auth.confirmPassword')} <span className='text-rose-500'>*</span>
          </label>
          <PasswordInput name="confirmPassword" autoComplete="new-password" required minLength={6} />

          {fetcher.data?.error && (
            <div
              className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
            >
              {fetcher.data.error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 mt-2 w-full rounded-xl py-3 text-sm font-bold tracking-widest disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff',
              border: '2px solid #4ade80',
            }}
          >
            {submitting ? <Loader size={16} className='animate-spin' /> : <UserRoundPlus size={16} />}
            {submitting ? t('auth.creating') : t('auth.createAccount')}
          </button>
        </fetcher.Form>

        <div className="mt-5 text-center text-sm" style={{ color: '#c4b5fd' }}>
          {t('auth.alreadyHaveAccount')}{' '}&nbsp;
          {onSwitchToLogin ? (
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="font-bold underline-offset-2 hover:underline"
              style={{ color: '#fde68a' }}
            >
              {t('auth.signIn')}
            </button>
          ) : (
            <a href="/login" className="font-bold" style={{ color: '#fde68a' }}>
              {t('auth.signIn')}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
