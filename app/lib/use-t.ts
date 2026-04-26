import { useMemo } from 'react'
import { useOutletContext } from 'react-router'
import { DEFAULT_LOCALE, t as translate, type Locale, type StringKey } from './i18n'

// Hook that returns a `t(key, vars?)` function bound to the current locale.
// The locale is read from the outlet context populated by the root loader.
export function useT() {
  const ctx = useOutletContext<{ locale?: Locale } | undefined>()
  const locale: Locale = ctx?.locale ?? DEFAULT_LOCALE
  return useMemo(
    () =>
      (key: StringKey, vars?: Record<string, string | number>): string =>
        translate(locale, key, vars),
    [locale],
  )
}

// Same as above but exposes the raw locale too — handy for components that
// need to render different markup per locale (e.g. flag icons).
export function useLocale(): Locale {
  const ctx = useOutletContext<{ locale?: Locale } | undefined>()
  return ctx?.locale ?? DEFAULT_LOCALE
}
