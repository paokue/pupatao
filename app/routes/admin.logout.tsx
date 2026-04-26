import { redirect } from 'react-router'
import type { Route } from './+types/admin.logout'
import { adminLogout } from '~/lib/admin-auth.server'

export async function action({ request }: Route.ActionArgs) {
  return adminLogout(request)
}

export function loader() {
  throw redirect('/admin/login')
}
