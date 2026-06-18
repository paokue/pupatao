import type { Route } from './+types/api.mark-tour-seen'
import { prisma } from '~/lib/prisma.server'

// Marks the feature-discovery tour as seen for this account, server-side, so
// it never auto-plays again — even after clearing browser storage or logging
// in on a different device. Idempotent; anonymous visitors get a no-op 200
// (their "seen" state lives in localStorage instead, see home.tsx).
export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  const user = await getCurrentUser(request)
  if (!user) return Response.json({ ok: true, anonymous: true })

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { hasSeenTour: true },
    })
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/mark-tour-seen]', err)
    return Response.json({ error: 'Failed to save.' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
