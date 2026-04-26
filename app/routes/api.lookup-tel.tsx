import type { Route } from './+types/api.lookup-tel'
import { prisma } from '~/lib/prisma.server'

// Recipient preview for the transfer flow. Authed; returns first/last name +
// tel of the user with the given tel, or { found: false } when not registered.
// Self-lookups are flagged so the UI can refuse to send to the sender.
export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  let me: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    me = await getCurrentUser(request)
  } catch (err) {
    console.error('[api/lookup-tel] session lookup failed:', err)
    return Response.json({ error: 'Could not verify session — please retry.' }, { status: 503 })
  }
  if (!me) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  let fd: FormData
  try {
    fd = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const tel = String(fd.get('tel') ?? '').trim()
  if (!tel) return Response.json({ error: 'Phone number required.' }, { status: 400 })

  if (tel === me.tel) {
    return Response.json({ found: true, isSelf: true })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { tel },
      select: { id: true, tel: true, firstName: true, lastName: true, status: true },
    })
    if (!user) return Response.json({ found: false })
    if (user.status !== 'ACTIVE') {
      return Response.json({ found: true, isInactive: true, user: { tel: user.tel } })
    }
    return Response.json({
      found: true,
      isSelf: false,
      user: {
        id: user.id,
        tel: user.tel,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    })
  } catch (err) {
    console.error('[api/lookup-tel]', err)
    return Response.json({ error: 'Could not look up recipient.' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
