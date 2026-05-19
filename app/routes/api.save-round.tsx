// Phase-2 of the two-phase RANDOM round flow.
// Called fire-and-forget by the client while the result is on screen.
// Verifies the HMAC token issued by /api/pick-dice, then writes the round,
// bets, wallet balance and ledger entries to the database.
import type { DiceSymbol, RangeKey, BetResult } from '@prisma/client'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyCompetition, notifyUser } from '~/lib/pusher.server'
import {
  SYMBOL_VALUES,
  type SymbolBetIn, type RangeBetIn, type PairBetIn,
  payoutForSymbol, payoutForRange, payoutForPair,
  getPayoutConfig,
} from '~/lib/game-logic.server'
import { verifyRoundToken } from '~/lib/round-token.server'

type WalletKey = 'DEMO' | 'REAL' | 'PROMO'

interface TokenPayload {
  dice:       [DiceSymbol, DiceSymbol, DiceSymbol]
  wallet:     WalletKey
  symbolBets: SymbolBetIn[]
  rangeBets:  RangeBetIn[]
  pairBets:   PairBetIn[]
  exp:        number
}

export async function action({ request }: { request: Request }) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  let user: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    user = await getCurrentUser(request)
  } catch {
    return Response.json({ error: 'Session error.' }, { status: 503 })
  }
  if (!user) return Response.json({ error: 'Signed out.' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object' || !('token' in raw) || typeof (raw as Record<string, unknown>).token !== 'string')
    return Response.json({ error: 'Missing token.' }, { status: 400 })

  let payload: TokenPayload
  try {
    payload = verifyRoundToken<TokenPayload>((raw as { token: string }).token)
  } catch {
    return Response.json({ error: 'Invalid or tampered token.' }, { status: 400 })
  }
  if (payload.exp < Date.now())
    return Response.json({ error: 'Token expired.' }, { status: 400 })

  const { dice, wallet: walletKey, symbolBets, rangeBets, pairBets } = payload
  const cfg = getPayoutConfig()
  const diceSum = SYMBOL_VALUES[dice[0]] + SYMBOL_VALUES[dice[1]] + SYMBOL_VALUES[dice[2]]

  // Compute payouts directly from the token dice.
  // pick-dice already called pickZeroPayoutDice when ADMIN_LOCKED or sleep mode
  // is active, so the token dice are already minimum-payout. We must NOT
  // force 0 here — when bets cover all ranges no 0-payout dice exists, and
  // re-picking in save-round would produce different dice from what the player
  // saw, creating a visible mismatch. Trust the HMAC-verified token dice.
  const symbolPayouts = symbolBets.map(b => payoutForSymbol(b, dice, cfg))
  const rangePayouts  = rangeBets.map(b => payoutForRange(b, diceSum, cfg))
  const pairPayouts   = pairBets.map(b => payoutForPair(b, dice, cfg))
  const totalStake =
    symbolBets.reduce((s, b) => s + b.amount, 0) +
    rangeBets.reduce((s, b) => s + b.amount, 0) +
    pairBets.reduce((s, b) => s + b.amount, 0)
  const totalPayout =
    symbolPayouts.reduce((a, b) => a + b, 0) +
    rangePayouts.reduce((a, b) => a + b, 0) +
    pairPayouts.reduce((a, b) => a + b, 0)

  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_type: { userId: user.id, type: walletKey } },
    })
    if (!wallet) return Response.json({ error: 'Wallet not found.' }, { status: 404 })
    if (wallet.balance < totalStake)
      return Response.json({ error: 'Insufficient balance.' }, { status: 400 })

    const isPromo = walletKey === 'PROMO'
    let promoStakeReturn = 0
    let realProfit = 0
    if (isPromo) {
      symbolBets.forEach((b, i) => { if (symbolPayouts[i] > 0) { promoStakeReturn += b.amount; realProfit += symbolPayouts[i] - b.amount } })
      rangeBets.forEach((b, i)  => { if (rangePayouts[i] > 0)  { promoStakeReturn += b.amount; realProfit += rangePayouts[i] - b.amount } })
      pairBets.forEach((b, i)   => { if (pairPayouts[i] > 0)   { promoStakeReturn += b.amount; realProfit += pairPayouts[i] - b.amount } })
    }
    const netDelta  = totalPayout - totalStake
    const newBalance = isPromo
      ? wallet.balance - totalStake + promoStakeReturn
      : wallet.balance + netDelta

    const result = await prisma.$transaction(async db => {
      const round = await db.gameRound.create({
        data: {
          mode: 'RANDOM', status: 'RESOLVED',
          dice1: dice[0], dice2: dice[1], dice3: dice[2], diceSum,
          bettingClosesAt: new Date(), resolvedAt: new Date(),
        },
      })
      const writes: Promise<unknown>[] = []
      symbolBets.forEach((b, i) => {
        const payout = symbolPayouts[i]
        writes.push(db.bet.create({ data: {
          roundId: round.id, userId: user!.id, walletId: wallet.id,
          kind: 'SYMBOL', amount: b.amount, payout, result: (payout > 0 ? 'WIN' : 'LOSS') as BetResult,
          symbol: b.symbol, cell: b.cell, resolvedAt: new Date(),
        }}))
      })
      rangeBets.forEach((b, i) => {
        const payout = rangePayouts[i]
        writes.push(db.bet.create({ data: {
          roundId: round.id, userId: user!.id, walletId: wallet.id,
          kind: 'RANGE', amount: b.amount, payout, result: (payout > 0 ? 'WIN' : 'LOSS') as BetResult,
          range: b.range, resolvedAt: new Date(),
        }}))
      })
      pairBets.forEach((b, i) => {
        const payout = pairPayouts[i]
        writes.push(db.bet.create({ data: {
          roundId: round.id, userId: user!.id, walletId: wallet.id,
          kind: 'PAIR', amount: b.amount, payout, result: (payout > 0 ? 'WIN' : 'LOSS') as BetResult,
          pairA: b.symbolA, pairB: b.symbolB, cellA: b.cellA, cellB: b.cellB, resolvedAt: new Date(),
        }}))
      })
      await Promise.all(writes)

      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance, version: { increment: 1 } },
      })

      const balanceAfterStake = wallet.balance - totalStake
      await db.transaction.create({ data: {
        userId: user!.id, walletId: wallet.id, type: 'LOSS',
        amount: totalStake, balanceBefore: wallet.balance, balanceAfter: balanceAfterStake,
        status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
        note: 'Self-play round stake',
      }})

      if (isPromo) {
        if (promoStakeReturn > 0) {
          await db.transaction.create({ data: {
            userId: user!.id, walletId: wallet.id, type: 'WIN',
            amount: promoStakeReturn, balanceBefore: balanceAfterStake, balanceAfter: newBalance,
            status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
            note: 'Self-play round — PROMO stake refund',
          }})
        }
        if (realProfit > 0) {
          const realWallet = await db.wallet.findUnique({ where: { userId_type: { userId: user!.id, type: 'REAL' } } })
          if (realWallet) {
            const newReal = realWallet.balance + realProfit
            await db.wallet.update({ where: { id: realWallet.id }, data: { balance: newReal, version: { increment: 1 } } })
            await db.transaction.create({ data: {
              userId: user!.id, walletId: realWallet.id, type: 'WIN',
              amount: realProfit, balanceBefore: realWallet.balance, balanceAfter: newReal,
              status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
              note: 'Self-play round — PROMO profit to REAL',
            }})
          }
        }
      } else if (totalPayout > 0) {
        await db.transaction.create({ data: {
          userId: user!.id, walletId: wallet.id, type: 'WIN',
          amount: totalPayout, balanceBefore: balanceAfterStake, balanceAfter: newBalance,
          status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
          note: 'Self-play round payout',
        }})
      }

      return { roundId: round.id }
    })

    notifyAdmin('round:resolved', { roundId: result.roundId, mode: 'RANDOM', dice: dice as string[], diceSum })
    notifyUser(user.id, 'round:resolved', { roundId: result.roundId, mode: 'RANDOM', dice: dice as string[], diceSum })
    // Broadcast ranking update for demo wallet bets so all open competition
    // pages re-fetch and animate the position change in real-time.
    if (walletKey === 'DEMO') {
      notifyCompetition('ranking:updated', { userId: user.id, newDemoBalance: newBalance })
    }

    return Response.json({ ok: true, balance: newBalance, payout: totalPayout, net: netDelta })
  } catch (err) {
    console.error('[api/save-round]', err)
    return Response.json({ error: 'Failed to save round.' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
