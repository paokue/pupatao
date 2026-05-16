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

export type WalletType = 'DEMO' | 'REAL' | 'PROMO'

// Per-phase win rates and dice-selection rules.
// PAIR/MIDDLE lock threshold is 10 000 ₭ in NORMAL tier (reduced from 50 k).
// All locked phases (A/B/C/ADMIN_LOCKED) always lock PAIR and MIDDLE.
function phaseSettings(wallet: WalletType, phase: SelfPlayPhase): {
  winChance: number
  pickMax: boolean
  lockAll: boolean
  lockBig: boolean  // lock PAIR/MIDDLE only when that specific bet > 10 000 ₭
} {
  if (wallet === 'DEMO') {
    return { winChance: 0.60, pickMax: true, lockAll: false, lockBig: false }
  }
  switch (phase) {
    case 'ADMIN_LOCKED': return { winChance: 0.00, pickMax: false, lockAll: true,  lockBig: false }
    case 'PHASE_C':      return { winChance: 0.05, pickMax: false, lockAll: true,  lockBig: false }
    case 'PHASE_B':      return { winChance: 0.30, pickMax: false, lockAll: true,  lockBig: false }
    case 'PHASE_A':      return { winChance: 0.10, pickMax: false, lockAll: true,  lockBig: false }
    default:             return { winChance: 0.50, pickMax: false, lockAll: false, lockBig: true  }
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

  const { winChance, pickMax, lockAll, lockBig } = phaseSettings(wallet, phase)
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

        // Filter combos where a locked bet would win.
        // Pair bets: always locked when lockAll OR lockBig (regardless of amount)
        //   — pair pays 6× so even small pair bets are very profitable at 50% win.
        // MIDDLE range bets: locked only when lockAll OR (lockBig AND amount > 10 000).
        if (lockAll || lockBig) {
          let skip = false
          for (const pb of pairBets) {
            if (lockAll || lockBig) {  // always lock pair bets when either flag is set
              if (dice.includes(pb.symbolA) && dice.includes(pb.symbolB)) { skip = true; break }
            }
          }
          if (!skip) {
            for (const rb of rangeBets) {
              if (rb.range === 'MIDDLE' && (lockAll || lockBig)) {
                if (sum >= 9 && sum <= 10) { skip = true; break }
              }
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

// Enumerate all 216 combos and return one with the absolute lowest total payout.
// Exported for direct use in api.pick-dice when the user is ADMIN_LOCKED.
export function pickZeroPayoutDice(
  symbolBets: SymbolBetIn[],
  rangeBets: RangeBetIn[],
  pairBets: PairBetIn[],
  cfg: PayoutConfig,
): [DiceSymbol, DiceSymbol, DiceSymbol] {
  let best: [DiceSymbol, DiceSymbol, DiceSymbol] = [SYMBOLS_BY_VALUE[0], SYMBOLS_BY_VALUE[0], SYMBOLS_BY_VALUE[0]]
  let bestPayout = Infinity

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
        if (payout < bestPayout) {
          bestPayout = payout
          best = dice
          if (payout === 0) break  // can't do better than 0
        }
      }
      if (bestPayout === 0) break
    }
    if (bestPayout === 0) break
  }

  return best
}
