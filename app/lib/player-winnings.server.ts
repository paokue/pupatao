// Returns the user's net profit (sum of WINs minus sum of LOSSes on REAL/PROMO
// wallets) since the last "fresh-start" deposit — a deposit that arrived when
// the REAL balance was under 5 000 Kip.  This is what drives tier selection:
//   profit < 200 000 → 60 % / 40 % tier
//   profit ≥ 200 000 → 10 % / 90 % strict tier
import { prisma } from './prisma.server'

export async function getPlayerProfitSinceReset(userId: string): Promise<number> {
  // Step 1 — find the most recent deposit while balance was nearly zero.
  const resetDeposit = await prisma.transaction.findFirst({
    where: { userId, type: 'DEPOSIT', balanceBefore: { lt: 5_000 }, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  const since = resetDeposit ? { createdAt: { gte: resetDeposit.createdAt } } : {}

  // Step 2 — find REAL/PROMO wallet IDs for this user.
  const wallets = await prisma.wallet.findMany({
    where: { userId, type: { in: ['REAL', 'PROMO'] } },
    select: { id: true },
  })
  const walletIds = wallets.map(w => w.id)

  // Step 3 — aggregate WINs and LOSSes in parallel.
  const [winsAgg, lossesAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: 'WIN',  walletId: { in: walletIds }, ...since },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: 'LOSS', walletId: { in: walletIds }, ...since },
      _sum: { amount: true },
    }),
  ])

  const totalWins   = winsAgg._sum.amount   ?? 0
  const totalLosses = lossesAgg._sum.amount ?? 0
  return totalWins - totalLosses
}
