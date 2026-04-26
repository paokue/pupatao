import { redirect } from 'react-router'
import type { Route } from './+types/api.locale'
import { buildLocaleCookie, isLocale } from '~/lib/i18n'

// POST /api/locale with `locale=lo|en` (and optional `redirectTo`). Sets the
// pupatao_locale cookie and redirects back to the page that submitted, so the
// SSR'd HTML on the next request reflects the new language.
export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData()
  const locale = String(fd.get('locale') ?? '')
  const redirectTo = String(fd.get('redirectTo') ?? '/') || '/'
  if (!isLocale(locale)) {
    return Response.json({ error: 'Unsupported locale.' }, { status: 400 })
  }
  return redirect(redirectTo, {
    headers: { 'Set-Cookie': buildLocaleCookie(locale) },
  })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
