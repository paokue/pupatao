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
      include: { round: { select: { status: true, bettingClosesAt: true } } },
    })
    if (!bet) return Response.json({ error: 'Bet not found' }, { status: 404 })
    if (bet.userId !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (bet.round?.status !== 'BETTING') return Response.json({ error: 'Betting is already closed' }, { status: 409 })
    // SECURITY: only allow cancelling while the betting COUNTDOWN is still
    // running. The round stays in BETTING status until the admin manually locks
    // it — which is after the countdown ends and the dealer reveals the dice on
    // the live stream. Without this check a player could watch the stream, see
    // the result, then cancel (refund) their losing bets before the admin locks.
    if (bet.round.bettingClosesAt && bet.round.bettingClosesAt.getTime() <= Date.now()) {
      return Response.json({ error: 'Betting window closed' }, { status: 409 })
    }
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
          // NOT 'DEPOSIT': the self-play phase anchor (player-winnings.server.ts)
          // keys off the latest COMPLETED deposit, so a deposit-typed refund would
          // let a user reset their netProfit/phase tier by bet+cancel. ADJUSTMENT
          // is neutral to that logic.
          type: 'ADJUSTMENT',
          amount: bet.amount,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          status: 'COMPLETED',
          roundId: bet.roundId, // link the refund to its round for auditing
          idempotencyKey: crypto.randomUUID(),
          note: 'Live bet cancelled — stake refunded',
        },
      })
      return { newBalance }
    })

    // Audit trail — every cancellation is recorded so abuse can be reviewed
    // later (e.g. a user who cancels heavily). Best-effort: never fail the cancel.
    const secondsLeft = bet.round?.bettingClosesAt
      ? Math.round((bet.round.bettingClosesAt.getTime() - Date.now()) / 1000)
      : null
    prisma.auditLog.create({
      data: {
        action: 'live.bet_cancel',
        target: `user:${user.id}`,
        metadata: {
          tel: user.tel,
          betId,
          roundId: bet.roundId,
          amount: bet.amount,
          kind: bet.kind,
          symbol: bet.symbol ?? bet.range ?? bet.exactSum ?? null,
          secondsLeftInWindow: secondsLeft, // how long was left on the countdown
        },
      },
    }).catch(err => console.error('[cancel-live-bet] audit log failed', err))
    console.log(`[cancel-live-bet] user=${user.tel} round=${bet.roundId} amount=${bet.amount} secondsLeft=${secondsLeft}`)

    return Response.json({ ok: true, newBalance: result.newBalance })
  } catch (err) {
    console.error('[cancel-live-bet]', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
