// Tiered withdrawal fee + daily cap. Client-safe (pure) so the WithdrawModal can
// show the fee and the wallet action can charge/record it from the same source.
//
// Fee tiers by withdrawal amount (₭):
//   0 – 299,999          → 1,000
//   300,000 – 499,999    → 5,000
//   500,000 – 999,999    → 10,000
//   1,000,000 – 1,999,999 → 20,000
//   2,000,000 – 4,999,999 → 50,000
//   ≥ 5,000,000          → 100,000
//
// The fee is deducted from the payout: the user requests `amount`, that full
// amount leaves their balance, and they receive `amount − fee`.
export function withdrawFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (amount < 300_000) return 1_000
  if (amount < 500_000) return 5_000
  if (amount < 1_000_000) return 10_000
  if (amount < 2_000_000) return 20_000
  if (amount < 5_000_000) return 50_000
  return 100_000
}

// Net amount the user actually receives after the fee.
export function withdrawNet(amount: number): number {
  return Math.max(0, amount - withdrawFee(amount))
}

// Max total a user may withdraw per day (sum of completed + pending requests).
export const MAX_WITHDRAW_PER_DAY = 10_000_000
