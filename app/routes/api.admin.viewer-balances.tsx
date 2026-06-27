import type { Route } from './+types/api.admin.viewer-balances'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'

// Returns current REAL balances for a set of user ids, so the admin Live page
// can show each viewer's live balance (refreshed when a round starts/resolves)
// instead of the snapshot captured when they joined the presence channel.
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  let body: { userIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((x): x is string => typeof x === 'string').slice(0, 300)
    : []
  if (userIds.length === 0) return Response.json({ balances: {} })

  const wallets = await prisma.wallet.findMany({
    where: { userId: { in: userIds }, type: 'REAL' },
    select: { userId: true, balance: true },
  })
  const balances: Record<string, number> = {}
  for (const w of wallets) balances[w.userId] = w.balance
  return Response.json({ balances })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
