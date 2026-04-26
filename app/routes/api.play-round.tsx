import type { Route } from './+types/api.play-round'
import type { DiceSymbol, RangeKey, BetResult } from '@prisma/client'
import { prisma } from '~/lib/prisma.server'

const SYMBOL_VALUES: Record<DiceSymbol, number> = {
  PRAWN: 1, CRAB: 2, FISH: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
}
const VALID_SYMBOLS: ReadonlyArray<DiceSymbol> = ['PRAWN', 'CRAB', 'FISH', 'ROOSTER', 'FROG', 'GOURD']
const RANGE_BOUNDS: Record<RangeKey, { min: number; max: number; multiplier: number }> = {
  LOW: { min: 3, max: 8, multiplier: 2 },
  MIDDLE: { min: 9, max: 10, multiplier: 4 },
  HIGH: { min: 11, max: 18, multiplier: 2 },
}
const VALID_RANGES: ReadonlyArray<RangeKey> = ['LOW', 'MIDDLE', 'HIGH']
const PAIR_MULTIPLIER = 6
const MAX_BET_PER_ROUND = 10_000_000  // sanity cap, prevents abuse

type Mode = 'RANDOM' | 'LIVE'
type WalletKey = 'DEMO' | 'REAL'

interface SymbolBetIn { symbol: DiceSymbol; cell: number; amount: number }
interface RangeBetIn { range: RangeKey; amount: number }
interface PairBetIn { symbolA: DiceSymbol; symbolB: DiceSymbol; cellA: number; cellB: number; amount: number }

interface PlayRoundPayload {
  mode: Mode
  wallet: WalletKey
  dice: [DiceSymbol, DiceSymbol, DiceSymbol]
  bets: {
    symbol?: SymbolBetIn[]
    range?: RangeBetIn[]
    pair?: PairBetIn[]
  }
}

function parsePayload(raw: unknown): PlayRoundPayload | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid payload.' }
  const p = raw as Partial<PlayRoundPayload>
  if (p.mode !== 'RANDOM' && p.mode !== 'LIVE') return { error: 'mode must be RANDOM or LIVE.' }
  if (p.wallet !== 'DEMO' && p.wallet !== 'REAL') return { error: 'wallet must be DEMO or REAL.' }
  if (!Array.isArray(p.dice) || p.dice.length !== 3) return { error: 'dice must be 3 symbols.' }
  for (const d of p.dice) {
    if (!VALID_SYMBOLS.includes(d as DiceSymbol)) return { error: `Invalid dice symbol: ${d}.` }
  }
  const bets = p.bets ?? {}
  const symbol = bets.symbol ?? []
  const range = bets.range ?? []
  const pair = bets.pair ?? []
  for (const s of symbol) {
    if (!VALID_SYMBOLS.includes(s.symbol)) return { error: `Invalid symbol: ${s.symbol}.` }
    if (!Number.isInteger(s.cell) || s.cell < 0 || s.cell > 7) return { error: 'Invalid symbol cell index.' }
    if (!Number.isInteger(s.amount) || s.amount <= 0) return { error: 'Symbol bet amount must be positive integer.' }
  }
  for (const r of range) {
    if (!VALID_RANGES.includes(r.range)) return { error: `Invalid range: ${r.range}.` }
    if (!Number.isInteger(r.amount) || r.amount <= 0) return { error: 'Range bet amount must be positive integer.' }
  }
  for (const pp of pair) {
    if (!VALID_SYMBOLS.includes(pp.symbolA) || !VALID_SYMBOLS.includes(pp.symbolB)) return { error: 'Invalid pair symbols.' }
    if (!Number.isInteger(pp.cellA) || !Number.isInteger(pp.cellB)) return { error: 'Invalid pair cells.' }
    if (!Number.isInteger(pp.amount) || pp.amount <= 0) return { error: 'Pair bet amount must be positive integer.' }
  }
  return { mode: p.mode, wallet: p.wallet, dice: p.dice as [DiceSymbol, DiceSymbol, DiceSymbol], bets: { symbol, range, pair } }
}

// Computes win for a single bet given the rolled dice. Returns total payout
// (includes stake on a win), 0 on a loss.
function payoutForSymbol(b: SymbolBetIn, dice: DiceSymbol[]): number {
  const matches = dice.filter(d => d === b.symbol).length
  return matches > 0 ? b.amount * (matches + 1) : 0
}
function payoutForRange(b: RangeBetIn, sum: number): number {
  const cfg = RANGE_BOUNDS[b.range]
  return sum >= cfg.min && sum <= cfg.max ? b.amount * cfg.multiplier : 0
}
function payoutForPair(b: PairBetIn, dice: DiceSymbol[]): number {
  return dice.includes(b.symbolA) && dice.includes(b.symbolB) ? b.amount * PAIR_MULTIPLIER : 0
}

export async function action({ request }: Route.ActionArgs) {
  // Resolve session manually instead of using `requireUser` so a missing/expired
  // session returns a JSON 401 here rather than throwing a redirect to /login.
  // A fetcher action that throws a redirect makes the browser navigate, which
  // looks exactly like the user got logged out — and a transient DB blip
  // shouldn't kick them off the play screen.
  const { getCurrentUser } = await import('~/lib/auth.server')
  let user: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    user = await getCurrentUser(request)
  } catch (err) {
    console.error('[api/play-round] session lookup failed:', err)
    return Response.json({ error: 'Could not verify session — please retry.' }, { status: 503 })
  }
  if (!user) {
    return Response.json({ error: 'You are signed out. Please sign in again.' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = parsePayload(raw)
  if ('error' in parsed) return Response.json(parsed, { status: 400 })
  const { mode, wallet: walletKey, dice, bets } = parsed

  const symbolBets = bets.symbol ?? []
  const rangeBets = bets.range ?? []
  const pairBets = bets.pair ?? []
  const totalStake =
    symbolBets.reduce((s, b) => s + b.amount, 0) +
    rangeBets.reduce((s, b) => s + b.amount, 0) +
    pairBets.reduce((s, b) => s + b.amount, 0)

  if (totalStake <= 0) {
    return Response.json({ error: 'No bets placed.' }, { status: 400 })
  }
  if (totalStake > MAX_BET_PER_ROUND) {
    return Response.json({ error: 'Round stake exceeds limit.' }, { status: 400 })
  }

  const diceSum = SYMBOL_VALUES[dice[0]] + SYMBOL_VALUES[dice[1]] + SYMBOL_VALUES[dice[2]]
  const symbolPayouts = symbolBets.map(b => payoutForSymbol(b, dice))
  const rangePayouts = rangeBets.map(b => payoutForRange(b, diceSum))
  const pairPayouts = pairBets.map(b => payoutForPair(b, dice))
  const totalPayout =
    symbolPayouts.reduce((a, b) => a + b, 0) +
    rangePayouts.reduce((a, b) => a + b, 0) +
    pairPayouts.reduce((a, b) => a + b, 0)
  const netDelta = totalPayout - totalStake

  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_type: { userId: user.id, type: walletKey } },
    })
    if (!wallet) return Response.json({ error: `${walletKey} wallet not found.` }, { status: 404 })
    if (wallet.balance < totalStake) {
      return Response.json({ error: 'Insufficient balance.' }, { status: 400 })
    }

    const newBalance = wallet.balance + netDelta

    const result = await prisma.$transaction(async db => {
      // 1. Round (resolved immediately — both self-play and player-entered live).
      const round = await db.gameRound.create({
        data: {
          mode,
          status: 'RESOLVED',
          dice1: dice[0],
          dice2: dice[1],
          dice3: dice[2],
          diceSum,
          bettingClosesAt: new Date(),
          resolvedAt: new Date(),
        },
      })

      // 2. Bets — one row per stake.
      const betWrites: Promise<unknown>[] = []
      symbolBets.forEach((b, i) => {
        const payout = symbolPayouts[i]
        const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
        betWrites.push(db.bet.create({
          data: {
            roundId: round.id,
            userId: user.id,
            walletId: wallet.id,
            kind: 'SYMBOL',
            amount: b.amount,
            payout,
            result,
            symbol: b.symbol,
            cell: b.cell,
            resolvedAt: new Date(),
          },
        }))
      })
      rangeBets.forEach((b, i) => {
        const payout = rangePayouts[i]
        const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
        betWrites.push(db.bet.create({
          data: {
            roundId: round.id,
            userId: user.id,
            walletId: wallet.id,
            kind: 'RANGE',
            amount: b.amount,
            payout,
            result,
            range: b.range,
            resolvedAt: new Date(),
          },
        }))
      })
      pairBets.forEach((b, i) => {
        const payout = pairPayouts[i]
        const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
        betWrites.push(db.bet.create({
          data: {
            roundId: round.id,
            userId: user.id,
            walletId: wallet.id,
            kind: 'PAIR',
            amount: b.amount,
            payout,
            result,
            pairA: b.symbolA,
            pairB: b.symbolB,
            cellA: b.cellA,
            cellB: b.cellB,
            resolvedAt: new Date(),
          },
        }))
      })
      await Promise.all(betWrites)

      // 3. Wallet balance.
      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance, version: { increment: 1 } },
      })

      // 4. Ledger — one LOSS row for the gross stake debit, plus one WIN row
      //    for the gross payout credit when there's any win. balanceBefore /
      //    After are stored sequentially so the ledger can be replayed.
      const balanceAfterStake = wallet.balance - totalStake
      await db.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: 'LOSS',
          amount: totalStake,
          balanceBefore: wallet.balance,
          balanceAfter: balanceAfterStake,
          status: 'COMPLETED',
          roundId: round.id,
          idempotencyKey: crypto.randomUUID(),
          note: `${mode === 'LIVE' ? 'Live' : 'Self-play'} round stake`,
        },
      })
      if (totalPayout > 0) {
        await db.transaction.create({
          data: {
            userId: user.id,
            walletId: wallet.id,
            type: 'WIN',
            amount: totalPayout,
            balanceBefore: balanceAfterStake,
            balanceAfter: newBalance,
            status: 'COMPLETED',
            roundId: round.id,
            idempotencyKey: crypto.randomUUID(),
            note: `${mode === 'LIVE' ? 'Live' : 'Self-play'} round payout`,
          },
        })
      }

      return { roundId: round.id }
    })

    return Response.json({
      ok: true,
      roundId: result.roundId,
      stake: totalStake,
      payout: totalPayout,
      net: netDelta,
      balance: newBalance,
    })
  } catch (err) {
    console.error('[api/play-round]', err)
    const isConn =
      err instanceof Error &&
      /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
    return Response.json(
      { error: isConn ? 'Cannot reach the database.' : err instanceof Error ? err.message : 'Failed to record round.' },
      { status: isConn ? 503 : 500 },
    )
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
