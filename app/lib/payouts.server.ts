// Centralised payout config. All multipliers are *total-return* multipliers
// (stake × multiplier = total credited on win, including the stake itself).
// Loader passes this object to the client so UI labels and the server's
// settlement math always agree.
//
// Env vars are read at request-time (not at module-load) so changes pick up
// on the next serverless cold-start without a code redeploy.

export type PayoutConfig = {
  symbol1: number  // 1 match  (default 2: stake 1,000 → 2,000)
  symbol2: number  // 2 matches (default 3: 1,000 → 3,000)
  symbol3: number  // 3 matches (default 4: 1,000 → 4,000)
  pair: number     // both pair symbols appear (default 6: 1,000 → 6,000)
  rangeLow: number     // sum 3-8  (default 2: 1,000 → 2,000)
  rangeMiddle: number  // sum 9-10 (default 6: 1,000 → 6,000)
  rangeHigh: number    // sum 11-18 (default 2: 1,000 → 2,000)
}

function envInt(name: string, def: number): number {
  const v = process.env[name]
  if (v == null || v === '') return def
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 1) return def
  return n
}

export function getPayoutConfig(): PayoutConfig {
  return {
    symbol1: envInt('PAYOUT_SYMBOL_1', 2),
    symbol2: envInt('PAYOUT_SYMBOL_2', 3),
    symbol3: envInt('PAYOUT_SYMBOL_3', 4),
    pair: envInt('PAYOUT_PAIR', 6),
    rangeLow: envInt('PAYOUT_RANGE_LOW', 2),
    rangeMiddle: envInt('PAYOUT_RANGE_MIDDLE', 6),
    rangeHigh: envInt('PAYOUT_RANGE_HIGH', 2),
  }
}
