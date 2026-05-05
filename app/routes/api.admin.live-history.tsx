import type { Route } from './+types/api.admin.live-history'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'

const PAGE_SIZE = 100

// Cursor-paginated history feed for the admin Live page. Takes a `before`
// ISO timestamp and returns up to PAGE_SIZE older rounds. We over-fetch by
// one row to set `hasMore` without an extra count query.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const before = url.searchParams.get('before')
  if (!before) return Response.json({ error: 'before required' }, { status: 400 })
  const beforeDate = new Date(before)
  if (Number.isNaN(beforeDate.getTime())) {
    return Response.json({ error: 'invalid before' }, { status: 400 })
  }

  const page = await prisma.gameRound.findMany({
    where: {
      mode: 'LIVE',
      createdAt: { lt: beforeDate },
    },
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE + 1,
    include: {
      host: { select: { email: true, firstName: true, lastName: true } },
      _count: { select: { bets: true } },
    },
  })

  const hasMore = page.length > PAGE_SIZE
  const history = page.slice(0, PAGE_SIZE).map(r => ({
    id: r.id,
    status: r.status,
    streamUrl: r.streamUrl,
    createdAt: r.createdAt.toISOString(),
    bettingOpensAt: r.bettingOpensAt.toISOString(),
    bettingClosesAt: r.bettingClosesAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    dice1: r.dice1,
    dice2: r.dice2,
    dice3: r.dice3,
    diceSum: r.diceSum,
    host: r.host
      ? [r.host.firstName, r.host.lastName].filter(Boolean).join(' ') || r.host.email
      : null,
    bets: r._count.bets,
  }))

  return Response.json({ history, hasMore })
}

export function action() {
  return new Response('Method Not Allowed', { status: 405 })
}
