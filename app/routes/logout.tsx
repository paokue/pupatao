import { redirect } from 'react-router'
import type { Route } from './+types/logout'
import { logout } from '~/lib/auth.server'

// Resource route — no UI. POST /logout from a <Form> in the profile dropdown.
export async function action({ request }: Route.ActionArgs) {
  return logout(request, '/login')
}

// Direct GET /logout → just bounce to login (doesn't revoke without POST to avoid CSRF).
export function loader() {
  throw redirect('/login')
}
