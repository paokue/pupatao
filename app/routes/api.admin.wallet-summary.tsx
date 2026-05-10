import type { Route } from './+types/api.admin.wallet-summary'
import type { TransactionType } from '@prisma/client'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'

// Money flowing INTO the user's wallets — left column of the summary modal.
// DEMO_RESET and ADJUSTMENT are excluded: a reset overwrites the balance
// rather than adding to it, and adjustments can go either way.
const INCOMING: TransactionType[] = [
  'DEPOSIT',
  'WIN',
  'TRANSFER_IN',
  'PROMO_BONUS',
  'REFERRAL_BONUS',
]

// Money flowing OUT of the user's wallets — right column.
const OUTGOING: TransactionType[] = ['WITHDRAW', 'LOSS', 'TRANSFER_OUT']

// `view` decides what the modal is currently showing — the API only runs the
// heavy query (recent list / aggregate groupBy) for the visible tab so opening
// one tab doesn't fetch the data the other tab would have used.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId')?.trim()
  const view = url.searchParams.get('view') === 'detail' ? 'detail' : 'summary'
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const [user, wallets] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, tel: true, firstName: true, lastName: true,
        status: true, role: true, createdAt: true,
      },
    }),
    prisma.wallet.findMany({
      where: { userId },
      select: { type: true, balance: true },
    }),
  ])

  if (!user) return Response.json({ error: 'User not found' }, { status: 404 })

  const userBase = {
    id: user.id,
    tel: user.tel,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    status: user.status,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
  const walletsBase = {
    real: wallets.find(w => w.type === 'REAL')?.balance ?? 0,
    demo: wallets.find(w => w.type === 'DEMO')?.balance ?? 0,
    promo: wallets.find(w => w.type === 'PROMO')?.balance ?? 0,
  }

  if (view === 'detail') {
    const recent = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true, type: true, amount: true, status: true,
        balanceBefore: true, balanceAfter: true, note: true, createdAt: true,
        wallet: { select: { type: true } },
      },
    })
    return {
      view: 'detail' as const,
      user: userBase,
      wallets: walletsBase,
      recent: recent.map(t => ({
        id: t.id,
        type: t.type,
        walletType: t.wallet?.type ?? null,
        amount: t.amount,
        status: t.status,
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
    }
  }

  // view === 'summary'
  const grouped = await prisma.transaction.groupBy({
    by: ['type'],
    where: { userId, status: 'COMPLETED' },
    _sum: { amount: true },
    _count: { _all: true },
  })

  const byType: Record<string, { total: number; count: number }> = {}
  for (const g of grouped) {
    byType[g.type] = { total: g._sum.amount ?? 0, count: g._count._all }
  }
  const incomingRows = INCOMING.map(t => ({
    type: t,
    total: byType[t]?.total ?? 0,
    count: byType[t]?.count ?? 0,
  }))
  const outgoingRows = OUTGOING.map(t => ({
    type: t,
    total: byType[t]?.total ?? 0,
    count: byType[t]?.count ?? 0,
  }))
  const incomingTotal = incomingRows.reduce((s, r) => s + r.total, 0)
  const outgoingTotal = outgoingRows.reduce((s, r) => s + r.total, 0)

  return {
    view: 'summary' as const,
    user: userBase,
    wallets: walletsBase,
    incoming: incomingRows,
    outgoing: outgoingRows,
    incomingTotal,
    outgoingTotal,
    calculatedAvailable: incomingTotal - outgoingTotal,
  }
}
