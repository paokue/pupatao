import type { DiceSymbol, RangeKey, SelfPlayPhase } from '@prisma/client'
import { getPayoutConfig, type PayoutConfig } from './payouts.server'

export { getPayoutConfig, type PayoutConfig }

export const SYMBOL_VALUES: Record<DiceSymbol, number> = {
  PRAWN: 1, FISH: 2, CRAB: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
}
export const VALID_SYMBOLS: ReadonlyArray<DiceSymbol> = ['PRAWN', 'CRAB', 'FISH', 'ROOSTER', 'FROG', 'GOURD']
export const RANGE_BOUNDS: Record<RangeKey, { min: number; max: number }> = {
  LOW: { min: 3, max: 8 },
  MIDDLE: { min: 9, max: 10 },
  HIGH: { min: 11, max: 18 },
}
export const VALID_RANGES: ReadonlyArray<RangeKey> = ['LOW', 'MIDDLE', 'HIGH']
export const SYMBOLS_BY_VALUE: DiceSymbol[] = ['PRAWN', 'FISH', 'CRAB', 'ROOSTER', 'FROG', 'GOURD']

export interface SymbolBetIn { symbol: DiceSymbol; cell: number; amount: number }
export interface RangeBetIn  { range: RangeKey; amount: number }
export interface PairBetIn   { symbolA: DiceSymbol; symbolB: DiceSymbol; cellA: number; cellB: number; amount: number }
export interface SumBetIn    { sum: number; amount: number }

export function payoutForSymbol(b: SymbolBetIn, dice: DiceSymbol[], cfg: PayoutConfig): number {
  const matches = dice.filter(d => d === b.symbol).length
  if (matches === 1) return b.amount * cfg.symbol1
  if (matches === 2) return b.amount * cfg.symbol2
  if (matches === 3) return b.amount * cfg.symbol3
  return 0
}
export function payoutForRange(b: RangeBetIn, sum: number, cfg: PayoutConfig): number {
  const { min, max } = RANGE_BOUNDS[b.range]
  if (sum < min || sum > max) return 0
  const mul = b.range === 'LOW' ? cfg.rangeLow : b.range === 'MIDDLE' ? cfg.rangeMiddle : cfg.rangeHigh
  return b.amount * mul
}
export function payoutForPair(b: PairBetIn, dice: DiceSymbol[], cfg: PayoutConfig): number {
  return dice.includes(b.symbolA) && dice.includes(b.symbolB) ? b.amount * cfg.pair : 0
}
export function payoutForSum(b: SumBetIn, diceSum: number, cfg: PayoutConfig): number {
  return diceSum === b.sum ? b.amount * cfg.sumNumber : 0
}

// LIVE-mode anti-payout rule for ADMIN_LOCKED users: a bet whose WINNINGS
// (profit = return − stake) would be STRICTLY GREATER than this is voided
// (refunded) at settle and hidden from the customer's own bet list. Winnings of
// exactly this amount are allowed through — e.g. a 100k pair returns 600k
// (×6) = 500k profit, so it stays; a larger pair (> 500k profit) is hidden.
export const LOCKED_LIVE_VOID_RETURN_MIN = 500_000

// SUM numbers that earn the ×6 promo return (matches admin.live settlement).
const PROMO_SPECIAL_SUMS = new Set([3, 7, 11, 15])

// Highest total amount a single LIVE bet would return to the player if it wins,
// by bet type (SYMBOL uses the standard single-match ×). Used only for the
// locked-user void rule — not for settlement.
export function liveBetPotentialReturn(
  b: { kind: string; amount: number; range?: RangeKey | null; exactSum?: number | null },
  cfg: PayoutConfig,
  opts?: { promoSum?: boolean },
): number {
  switch (b.kind) {
    case 'SYMBOL':
      return b.amount * cfg.symbol1
    case 'RANGE':
      return b.amount * (b.range === 'LOW' ? cfg.rangeLow : b.range === 'MIDDLE' ? cfg.rangeMiddle : cfg.rangeHigh)
    case 'PAIR':
      return b.amount * cfg.pair
    case 'SUM':
      return opts?.promoSum && b.exactSum != null && PROMO_SPECIAL_SUMS.has(b.exactSum)
        ? b.amount * 6
        : b.amount * cfg.sumNumber
    default:
      return 0
  }
}

export type WalletType = 'DEMO' | 'REAL' | 'PROMO'

// Per-phase win rates and dice-selection rules.
// NORMAL phase: no pair/middle locking — all bet types win at 50 %.
// Phase A/B/C and ADMIN_LOCKED: pair and middle are always locked (lockAll).
function phaseSettings(wallet: WalletType, phase: SelfPlayPhase): {
  winChance: number
  pickMax: boolean
  lockAll: boolean
} {
  if (wallet === 'DEMO') {
    return { winChance: 0.50, pickMax: true, lockAll: false }
  }
  switch (phase) {
    case 'ADMIN_LOCKED': return { winChance: 0.00, pickMax: false, lockAll: true }
    case 'PHASE_C':      return { winChance: 0.05, pickMax: false, lockAll: true }
    case 'PHASE_B':      return { winChance: 0.30, pickMax: false, lockAll: true }
    case 'PHASE_A':      return { winChance: 0.10, pickMax: false, lockAll: true }
    default:             return { winChance: 0.50, pickMax: false, lockAll: false }
  }
}

export function pickAdversarialDice(
  symbolBets: SymbolBetIn[],
  rangeBets: RangeBetIn[],
  pairBets: PairBetIn[],
  cfg: PayoutConfig,
  wallet: WalletType = 'REAL',
  phase: SelfPlayPhase = 'NORMAL',
): [DiceSymbol, DiceSymbol, DiceSymbol] {
  // ADMIN_LOCKED: hard-guarantee zero payout — no randomness, no chance of win.
  if (wallet !== 'DEMO' && phase === 'ADMIN_LOCKED') {
    return pickZeroPayoutDice(symbolBets, rangeBets, pairBets, cfg)
  }

  const { winChance, pickMax, lockAll } = phaseSettings(wallet, phase)
  const isWinRound = Math.random() < winChance

  type Entry = { dice: [DiceSymbol, DiceSymbol, DiceSymbol]; payout: number }
  const eligible: Entry[] = []

  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let c = 1; c <= 6; c++) {
        const dice: [DiceSymbol, DiceSymbol, DiceSymbol] = [
          SYMBOLS_BY_VALUE[a - 1],
          SYMBOLS_BY_VALUE[b - 1],
          SYMBOLS_BY_VALUE[c - 1],
        ]
        const sum = a + b + c

        // In locked phases (A/B/C/ADMIN_LOCKED), filter out combos where
        // pair or MIDDLE bets would win — these bets can never win.
        // NORMAL phase: no filtering, all bet types can win at 50 %.
        if (lockAll) {
          let skip = false
          for (const pb of pairBets) {
            if (dice.includes(pb.symbolA) && dice.includes(pb.symbolB)) { skip = true; break }
          }
          if (!skip) {
            for (const rb of rangeBets) {
              if (rb.range === 'MIDDLE' && sum >= 9 && sum <= 10) { skip = true; break }
            }
          }
          if (skip) continue
        }

        let payout = 0
        for (const sb of symbolBets) payout += payoutForSymbol(sb, dice, cfg)
        for (const rb of rangeBets)  payout += payoutForRange(rb, sum, cfg)
        for (const pb of pairBets)   payout += payoutForPair(pb, dice, cfg)
        eligible.push({ dice, payout })
      }
    }
  }

  if (eligible.length === 0) return pickZeroPayoutDice(symbolBets, rangeBets, pairBets, cfg)

  if (isWinRound) {
    const winners = eligible.filter(e => e.payout > 0)
    if (winners.length > 0) {
      if (pickMax) {
        const maxWin = Math.max(...winners.map(e => e.payout))
        const best = winners.filter(e => e.payout === maxWin)
        return best[Math.floor(Math.random() * best.length)].dice
      } else {
        const minWin = Math.min(...winners.map(e => e.payout))
        const best = winners.filter(e => e.payout === minWin)
        return best[Math.floor(Math.random() * best.length)].dice
      }
    }
    // No winning combo exists (all locked) → fall through to loss.
  }

  // Loss: pick minimum-payout combo (usually 0).
  const minLoss = Math.min(...eligible.map(e => e.payout))
  const best = eligible.filter(e => e.payout === minLoss)
  return best[Math.floor(Math.random() * best.length)].dice
}

// Enumerate all 216 combos, collect every combo that yields the minimum payout
// (ideally 0), then return a RANDOM one so the dice look natural to the player.
// Exported for direct use in api.pick-dice when the user is ADMIN_LOCKED.
export function pickZeroPayoutDice(
  symbolBets: SymbolBetIn[],
  rangeBets: RangeBetIn[],
  pairBets: PairBetIn[],
  cfg: PayoutConfig,
): [DiceSymbol, DiceSymbol, DiceSymbol] {
  type Entry = { dice: [DiceSymbol, DiceSymbol, DiceSymbol]; payout: number }
  const all: Entry[] = []

  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let c = 1; c <= 6; c++) {
        const dice: [DiceSymbol, DiceSymbol, DiceSymbol] = [
          SYMBOLS_BY_VALUE[a - 1],
          SYMBOLS_BY_VALUE[b - 1],
          SYMBOLS_BY_VALUE[c - 1],
        ]
        const sum = a + b + c
        let payout = 0
        for (const sb of symbolBets) payout += payoutForSymbol(sb, dice, cfg)
        for (const rb of rangeBets)  payout += payoutForRange(rb, sum, cfg)
        for (const pb of pairBets)   payout += payoutForPair(pb, dice, cfg)
        all.push({ dice, payout })
      }
    }
  }

  // Find the minimum payout across all combos (ideally 0).
  const minPayout = Math.min(...all.map(e => e.payout))
  const losers = all.filter(e => e.payout === minPayout)

  // Pick randomly from the losers so the dice look natural and varied.
  return losers[Math.floor(Math.random() * losers.length)].dice
}
