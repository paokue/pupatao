import { useFetcher, useLocation } from 'react-router'
import { Globe } from 'lucide-react'
import { LOCALES, LOCALE_FLAG, LOCALE_LABEL, type Locale } from '~/lib/i18n'
import { useLocale } from '~/lib/use-t'

interface Props {
  /** Layout variant. `pill` is the dense header pill; `inline` is a row of
   *  buttons used on the profile page. */
  variant?: 'pill' | 'inline'
}

// Submits to /api/locale, which sets the cookie and redirects back so the
// next SSR pass renders in the chosen language.
export function LanguageSwitch({ variant = 'inline' }: Props) {
  const fetcher = useFetcher()
  const location = useLocation()
  const current = useLocale()

  function pick(locale: Locale) {
    if (locale === current) return
    const fd = new FormData()
    fd.append('locale', locale)
    fd.append('redirectTo', location.pathname + location.search)
    fetcher.submit(fd, { method: 'post', action: '/api/locale' })
  }

  if (variant === 'pill') {
    const next: Locale = current === 'lo' ? 'en' : 'lo'
    return (
      <button
        type="button"
        onClick={() => pick(next)}
        title={`Switch to ${LOCALE_LABEL[next]}`}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest transition-opacity hover:opacity-90"
        style={{ background: '#4c1d95', color: '#fde68a', border: '1px solid #7c3aed' }}
      >
        <Globe size={11} />
        <span aria-hidden>{LOCALE_FLAG[next]}</span>
        {LOCALE_LABEL[next]}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      {LOCALES.map(l => {
        const active = l === current
        return (
          <button
            key={l}
            type="button"
            onClick={() => pick(l)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold tracking-widest transition-opacity hover:opacity-90"
            style={{
              background: active ? '#7c3aed' : '#2d1b4e',
              color: active ? '#fff' : '#c4b5fd',
              border: `1.5px solid ${active ? '#fde68a' : '#4c1d95'}`,
            }}
          >
            <span aria-hidden className="text-base leading-none">{LOCALE_FLAG[l]}</span>
            <span>{LOCALE_LABEL[l]}</span>
          </button>
        )
      })}
    </div>
  )
}
