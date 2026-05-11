import type { DiceSymbol, RangeKey } from '@prisma/client'
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
// Ordered strictly by numeric value 1–6 for index-based mapping.
export const SYMBOLS_BY_VALUE: DiceSymbol[] = ['PRAWN', 'FISH', 'CRAB', 'ROOSTER', 'FROG', 'GOURD']

export interface SymbolBetIn { symbol: DiceSymbol; cell: number; amount: number }
export interface RangeBetIn  { range: RangeKey; amount: number }
export interface PairBetIn   { symbolA: DiceSymbol; symbolB: DiceSymbol; cellA: number; cellB: number; amount: number }

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

export function pickAdversarialDice(
  symbolBets: SymbolBetIn[],
  rangeBets: RangeBetIn[],
  pairBets: PairBetIn[],
  cfg: PayoutConfig,
): [DiceSymbol, DiceSymbol, DiceSymbol] {
  if (rangeBets.length === 0) {
    return [
      VALID_SYMBOLS[Math.floor(Math.random() * 6)],
      VALID_SYMBOLS[Math.floor(Math.random() * 6)],
      VALID_SYMBOLS[Math.floor(Math.random() * 6)],
    ]
  }
  let minPayout = Infinity
  const best: Array<[DiceSymbol, DiceSymbol, DiceSymbol]> = []
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
        if (payout < minPayout) { minPayout = payout; best.length = 0; best.push(dice) }
        else if (payout === minPayout) best.push(dice)
      }
    }
  }
  return best[Math.floor(Math.random() * best.length)]
}
