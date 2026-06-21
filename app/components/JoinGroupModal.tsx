import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useT } from '~/lib/use-t'

// Demo placeholders — swap via VITE_WHATSAPP_GROUP_URL / VITE_MESSENGER_GROUP_URL in .env.
const WHATSAPP_GROUP_URL = import.meta.env.VITE_WHATSAPP_GROUP_URL || 'https://chat.whatsapp.com/DEMO_GROUP_ID'
const MESSENGER_GROUP_URL = import.meta.env.VITE_MESSENGER_GROUP_URL || 'https://m.me/j/DEMO_GROUP_ID'

interface JoinGroupModalProps {
  open: boolean
  onClose: () => void
}

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-1.74-.792-2.844-1.422-3.928-3.207-.299-.514.298-.477.852-1.586.094-.184.047-.347-.066-.51-.116-.16-.493-1.114-.671-1.541-.18-.428-.36-.346-.522-.346-.166 0-.41.06-.64.346-.234.291-.864.84-.864 2.063 0 1.224.892 2.41 1.018 2.58.13.166 1.745 2.78 4.353 3.778 2.169.798 2.65.665 3.119.59.502-.08 1.612-.66 1.84-1.298.231-.638.231-1.183.16-1.298-.07-.116-.196-.176-.395-.327z" />
      <path d="M12.012 2C6.49 2 2 6.477 2 11.995c0 1.93.582 3.766 1.638 5.355L2 22l4.86-1.602A9.974 9.974 0 0 0 12.013 22C17.534 22 22 17.523 22 11.995 22 6.477 17.534 2 12.012 2zm0 18.184c-1.7 0-3.346-.452-4.792-1.31l-.343-.205-3.598.998 1.01-3.532-.222-.357a8.197 8.197 0 0 1-1.245-4.34c0-4.526 3.74-8.27 8.19-8.27 4.526 0 8.207 3.7 8.207 8.21 0 4.526-3.7 8.206-8.207 8.206z" />
    </svg>
  )
}

function MessengerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M12 0C5.231 0 0 4.86 0 11.077c0 3.34 1.547 6.166 4.078 8.116.21.163.282.39.305.61l.34 1.948c.05.296.272.474.546.474.107 0 .222-.025.34-.078l2.196-1.063c.181-.087.367-.1.546-.05a12.66 12.66 0 0 0 3.66.5C18.768 21.534 24 16.674 24 10.457 24 4.86 18.768 0 12 0zm6.07 8.302l-3.16 4.99c-.504.794-1.591.985-2.341.412l-2.518-1.886a.703.703 0 0 0-.844 0l-3.39 2.57c-.452.345-1.024-.166-.724-.65l3.16-4.99c.503-.794 1.59-.985 2.34-.412l2.519 1.886a.702.702 0 0 0 .843 0l3.39-2.57c.453-.345 1.024.166.724.65z" />
    </svg>
  )
}

// Lets a customer pick WhatsApp or Messenger and jump straight into the
// official community group invite link — clicking either opens it in a new
// tab so the platform's own "Join" flow takes over from there.
export function JoinGroupModal({ open, onClose }: JoinGroupModalProps) {
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
          'relative w-full p-6',
          'rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'animate-in slide-in-from-bottom duration-300',
          'md:h-auto md:w-full md:max-w-md md:rounded-xl md:pb-6 md:animate-in md:fade-in md:zoom-in-95 md:duration-200',
        ].join(' ')}
        style={{
          background: 'linear-gradient(135deg, #4c1d95, #1e0040)',
          boxShadow: '0 10px 60px rgba(0,0,0,0.7)',
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 rounded-full md:hidden"
          style={{ background: '#7c3aed' }}
        />

        <button
          onClick={onClose}
          type="button"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#e9d5ff' }}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        <h2 className="mb-1 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
          {t('joinGroup.title')}
        </h2>
        <p className="mb-5 text-center text-[13px]" style={{ color: '#c4b5fd' }}>
          {t('joinGroup.subtitle')}
        </p>

        <div className="flex gap-3">
          <a
            href={WHATSAPP_GROUP_URL}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: '2px solid #4ade80' }}
          >
            <WhatsAppIcon size={18} />
            {t('joinGroup.whatsapp')}
          </a>
          <a
            href={MESSENGER_GROUP_URL}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', border: '2px solid #60a5fa' }}
          >
            <MessengerIcon size={18} />
            {t('joinGroup.messenger')}
          </a>
        </div>
      </div>
    </div>
  )
}
