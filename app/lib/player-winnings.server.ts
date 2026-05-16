// Returns the user's net profit and last qualifying deposit amount for tier
// selection in self-play mode.
//
// Reset trigger: the most recent DEPOSIT with amount ≥ 50,000 ₭ resets the
// profit counter. Deposits below 50,000 ₭ are ignored so top-ups of pocket
// change don't wipe the phase tracking.
import { prisma } from './prisma.server'

export interface PlayerGameState {
  netProfit: number         // total WINs − total LOSSes on REAL/PROMO since last reset
  lastDepositAmount: number // amount of the last qualifying deposit (≥ 50 000 ₭); 0 if none
}

export async function getPlayerGameState(userId: string): Promise<PlayerGameState> {
  // Step 1 — find the most recent deposit ≥ 50 000 ₭ (the reset anchor).
  const resetDeposit = await prisma.transaction.findFirst({
    where: { userId, type: 'DEPOSIT', amount: { gte: 50_000 }, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, amount: true },
  })

  const since = resetDeposit ? { createdAt: { gte: resetDeposit.createdAt } } : {}
  const lastDepositAmount = resetDeposit?.amount ?? 0

  // Step 2 — REAL/PROMO wallet IDs for this user.
  const wallets = await prisma.wallet.findMany({
    where: { userId, type: { in: ['REAL', 'PROMO'] } },
    select: { id: true },
  })
  const walletIds = wallets.map(w => w.id)

  // Step 3 — aggregate WINs and LOSSes in parallel.
  const [winsAgg, lossesAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: 'WIN', walletId: { in: walletIds }, ...since },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: 'LOSS', walletId: { in: walletIds }, ...since },
      _sum: { amount: true },
    }),
  ])

  return {
    netProfit: (winsAgg._sum.amount ?? 0) - (lossesAgg._sum.amount ?? 0),
    lastDepositAmount,
  }
}

// Legacy export kept so any existing callers don't break while we migrate.
export async function getPlayerProfitSinceReset(userId: string): Promise<number> {
  const state = await getPlayerGameState(userId)
  return state.netProfit
}
