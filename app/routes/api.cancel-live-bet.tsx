import type { Route } from './+types/api.cancel-live-bet'
import { prisma } from '~/lib/prisma.server'

export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  const user = await getCurrentUser(request)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  let body: { betId?: string }
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { betId } = body
  if (!betId) return Response.json({ error: 'betId required' }, { status: 400 })

  try {
    const bet = await prisma.bet.findUnique({
      where: { id: betId },
      include: { round: { select: { status: true } } },
    })
    if (!bet) return Response.json({ error: 'Bet not found' }, { status: 404 })
    if (bet.userId !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (bet.round?.status !== 'BETTING') return Response.json({ error: 'Betting is already closed' }, { status: 409 })
    if (bet.result !== null) return Response.json({ error: 'Bet already settled' }, { status: 409 })

    const result = await prisma.$transaction(async db => {
      await db.bet.delete({ where: { id: betId } })
      const wallet = await db.wallet.findUnique({ where: { id: bet.walletId } })
      if (!wallet) throw new Error('Wallet not found')
      const newBalance = wallet.balance + bet.amount
      await db.wallet.update({
        where: { id: bet.walletId },
        data: { balance: newBalance, version: { increment: 1 } },
      })
      await db.transaction.create({
        data: {
          userId: user.id,
          walletId: bet.walletId,
          type: 'DEPOSIT',
          amount: bet.amount,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          status: 'COMPLETED',
          idempotencyKey: crypto.randomUUID(),
          note: 'Live bet cancelled — stake refunded',
        },
      })
      return { newBalance }
    })

    return Response.json({ ok: true, newBalance: result.newBalance })
  } catch (err) {
    console.error('[cancel-live-bet]', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
