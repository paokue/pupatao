// Phase-1 of the two-phase RANDOM round flow.
// Picks adversarial dice and signs the result so Phase-2 (/api/save-round) can
// trust it. For REAL/PROMO wallets a single aggregate query fetches the user's
// cumulative winnings to select the correct house-edge tier; DEMO skips the DB.
import type { DiceSymbol, RangeKey } from '@prisma/client'
import {
  VALID_SYMBOLS, VALID_RANGES,
  type SymbolBetIn, type RangeBetIn, type PairBetIn,
  type WalletType,
  pickAdversarialDice, getPayoutConfig,
} from '~/lib/game-logic.server'
import { signRoundToken } from '~/lib/round-token.server'

type WalletKey = 'DEMO' | 'REAL' | 'PROMO'

function parseBets(raw: unknown): {
  wallet: WalletKey
  symbolBets: SymbolBetIn[]
  rangeBets: RangeBetIn[]
  pairBets: PairBetIn[]
} | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid payload.' }
  const p = raw as Record<string, unknown>

  if (p.wallet !== 'DEMO' && p.wallet !== 'REAL' && p.wallet !== 'PROMO')
    return { error: 'wallet must be DEMO, REAL or PROMO.' }

  const bets = (p.bets ?? {}) as Record<string, unknown>
  const symbol = (Array.isArray(bets.symbol) ? bets.symbol : []) as SymbolBetIn[]
  const range  = (Array.isArray(bets.range)  ? bets.range  : []) as RangeBetIn[]
  const pair   = (Array.isArray(bets.pair)   ? bets.pair   : []) as PairBetIn[]

  for (const s of symbol) {
    if (!VALID_SYMBOLS.includes(s.symbol)) return { error: `Invalid symbol: ${s.symbol}` }
    if (!Number.isInteger(s.amount) || s.amount <= 0) return { error: 'Symbol bet amount invalid.' }
  }
  for (const r of range) {
    if (!VALID_RANGES.includes(r.range)) return { error: `Invalid range: ${r.range}` }
    if (!Number.isInteger(r.amount) || r.amount <= 0) return { error: 'Range bet amount invalid.' }
  }
  for (const pp of pair) {
    if (!VALID_SYMBOLS.includes(pp.symbolA) || !VALID_SYMBOLS.includes(pp.symbolB))
      return { error: 'Invalid pair symbols.' }
    if (!Number.isInteger(pp.amount) || pp.amount <= 0) return { error: 'Pair bet amount invalid.' }
  }

  return { wallet: p.wallet as WalletKey, symbolBets: symbol, rangeBets: range, pairBets: pair }
}

export async function action({ request }: { request: Request }) {
  let raw: unknown
  try { raw = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = parseBets(raw)
  if ('error' in parsed) return Response.json(parsed, { status: 400 })

  // For REAL/PROMO wallets fetch net profit since the last fresh-start deposit
  // to select the correct tier. DEMO skips the DB entirely.
  let netProfit = 0
  if (parsed.wallet !== 'DEMO') {
    const { getCurrentUser } = await import('~/lib/auth.server')
    const { getPlayerProfitSinceReset } = await import('~/lib/player-winnings.server')
    let user: Awaited<ReturnType<typeof getCurrentUser>>
    try {
      user = await getCurrentUser(request)
    } catch {
      return Response.json({ error: 'Session error.' }, { status: 503 })
    }
    if (!user) return Response.json({ error: 'Signed out.' }, { status: 401 })
    try {
      netProfit = await getPlayerProfitSinceReset(user.id)
    } catch {
      // On DB failure, default to the strictest tier (≥200k) to protect the house.
      netProfit = 200_000
    }
  }

  const cfg  = getPayoutConfig()
  const dice = pickAdversarialDice(parsed.symbolBets, parsed.rangeBets, parsed.pairBets, cfg, parsed.wallet as WalletType, netProfit)

  const token = signRoundToken({
    dice,
    wallet: parsed.wallet,
    symbolBets: parsed.symbolBets,
    rangeBets:  parsed.rangeBets,
    pairBets:   parsed.pairBets,
    exp: Date.now() + 120_000, // token valid for 2 minutes
  })

  return Response.json({ ok: true, dice, token })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
