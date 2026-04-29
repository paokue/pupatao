import type { Route } from './+types/api.play-round'
import type { DiceSymbol, RangeKey, BetResult } from '@prisma/client'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyUser } from '~/lib/pusher.server'
import type { BetPlacedPayload } from '~/lib/pusher-channels'
import { getPayoutConfig, type PayoutConfig } from '~/lib/payouts.server'

const SYMBOL_VALUES: Record<DiceSymbol, number> = {
  PRAWN: 1, CRAB: 2, FISH: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
}
const VALID_SYMBOLS: ReadonlyArray<DiceSymbol> = ['PRAWN', 'CRAB', 'FISH', 'ROOSTER', 'FROG', 'GOURD']
const RANGE_BOUNDS: Record<RangeKey, { min: number; max: number }> = {
  LOW: { min: 3, max: 8 },
  MIDDLE: { min: 9, max: 10 },
  HIGH: { min: 11, max: 18 },
}
const VALID_RANGES: ReadonlyArray<RangeKey> = ['LOW', 'MIDDLE', 'HIGH']
const MAX_BET_PER_ROUND = 10_000_000  // sanity cap, prevents abuse

type Mode = 'RANDOM' | 'LIVE'
type WalletKey = 'DEMO' | 'REAL'

interface SymbolBetIn { symbol: DiceSymbol; cell: number; amount: number }
interface RangeBetIn { range: RangeKey; amount: number }
interface PairBetIn { symbolA: DiceSymbol; symbolB: DiceSymbol; cellA: number; cellB: number; amount: number }

interface PlayRoundPayload {
  mode: Mode
  wallet: WalletKey
  // Required for RANDOM (self-play, customer rolls); ignored for LIVE — the
  // admin/host enters dice on the admin Live page.
  dice?: [DiceSymbol, DiceSymbol, DiceSymbol]
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
  if (p.mode === 'RANDOM') {
    if (!Array.isArray(p.dice) || p.dice.length !== 3) return { error: 'dice must be 3 symbols.' }
    for (const d of p.dice) {
      if (!VALID_SYMBOLS.includes(d as DiceSymbol)) return { error: `Invalid dice symbol: ${d}.` }
    }
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
  return {
    mode: p.mode,
    wallet: p.wallet,
    dice: p.mode === 'RANDOM' ? (p.dice as [DiceSymbol, DiceSymbol, DiceSymbol]) : undefined,
    bets: { symbol, range, pair },
  }
}

// Computes win for a single bet given the rolled dice. Returns total payout
// (includes stake on a win), 0 on a loss. Multipliers come from getPayoutConfig()
// so they can be tuned via env without a code change.
function payoutForSymbol(b: SymbolBetIn, dice: DiceSymbol[], cfg: PayoutConfig): number {
  const matches = dice.filter(d => d === b.symbol).length
  if (matches === 1) return b.amount * cfg.symbol1
  if (matches === 2) return b.amount * cfg.symbol2
  if (matches === 3) return b.amount * cfg.symbol3
  return 0
}
function payoutForRange(b: RangeBetIn, sum: number, cfg: PayoutConfig): number {
  const bounds = RANGE_BOUNDS[b.range]
  if (sum < bounds.min || sum > bounds.max) return 0
  const mul = b.range === 'LOW' ? cfg.rangeLow : b.range === 'MIDDLE' ? cfg.rangeMiddle : cfg.rangeHigh
  return b.amount * mul
}
function payoutForPair(b: PairBetIn, dice: DiceSymbol[], cfg: PayoutConfig): number {
  return dice.includes(b.symbolA) && dice.includes(b.symbolB) ? b.amount * cfg.pair : 0
}

export async function action({ request }: Route.ActionArgs) {
  // Resolve session manually instead of using `requireUser` so a missing/expired
  // session returns a JSON 401 here rather than throwing a redirect to /login.
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

  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_type: { userId: user.id, type: walletKey } },
    })
    if (!wallet) return Response.json({ error: `${walletKey} wallet not found.` }, { status: 404 })
    if (wallet.balance < totalStake) {
      return Response.json({ error: 'Insufficient balance.' }, { status: 400 })
    }

    if (mode === 'LIVE') {
      return await handleLiveBets({ user, wallet, walletKey, totalStake, symbolBets, rangeBets, pairBets })
    }
    return await handleRandomRound({
      user, wallet, walletKey, totalStake,
      dice: dice as [DiceSymbol, DiceSymbol, DiceSymbol],
      symbolBets, rangeBets, pairBets,
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

// ─── RANDOM (self-play) — original flow: round + bets + ledger all settle in one shot.
async function handleRandomRound(args: {
  user: { id: string; tel: string; firstName: string | null; lastName: string | null }
  wallet: { id: string; balance: number }
  walletKey: WalletKey
  totalStake: number
  dice: [DiceSymbol, DiceSymbol, DiceSymbol]
  symbolBets: SymbolBetIn[]
  rangeBets: RangeBetIn[]
  pairBets: PairBetIn[]
}) {
  const { user, wallet, totalStake, dice, symbolBets, rangeBets, pairBets } = args
  const cfg = getPayoutConfig()
  const diceSum = SYMBOL_VALUES[dice[0]] + SYMBOL_VALUES[dice[1]] + SYMBOL_VALUES[dice[2]]
  const symbolPayouts = symbolBets.map(b => payoutForSymbol(b, dice, cfg))
  const rangePayouts = rangeBets.map(b => payoutForRange(b, diceSum, cfg))
  const pairPayouts = pairBets.map(b => payoutForPair(b, dice, cfg))
  const totalPayout =
    symbolPayouts.reduce((a, b) => a + b, 0) +
    rangePayouts.reduce((a, b) => a + b, 0) +
    pairPayouts.reduce((a, b) => a + b, 0)
  const netDelta = totalPayout - totalStake
  const newBalance = wallet.balance + netDelta

  const result = await prisma.$transaction(async db => {
    const round = await db.gameRound.create({
      data: {
        mode: 'RANDOM',
        status: 'RESOLVED',
        dice1: dice[0], dice2: dice[1], dice3: dice[2], diceSum,
        bettingClosesAt: new Date(),
        resolvedAt: new Date(),
      },
    })

    const betWrites: Promise<unknown>[] = []
    symbolBets.forEach((b, i) => {
      const payout = symbolPayouts[i]
      const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
      betWrites.push(db.bet.create({
        data: {
          roundId: round.id, userId: user.id, walletId: wallet.id,
          kind: 'SYMBOL', amount: b.amount, payout, result,
          symbol: b.symbol, cell: b.cell, resolvedAt: new Date(),
        },
      }))
    })
    rangeBets.forEach((b, i) => {
      const payout = rangePayouts[i]
      const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
      betWrites.push(db.bet.create({
        data: {
          roundId: round.id, userId: user.id, walletId: wallet.id,
          kind: 'RANGE', amount: b.amount, payout, result,
          range: b.range, resolvedAt: new Date(),
        },
      }))
    })
    pairBets.forEach((b, i) => {
      const payout = pairPayouts[i]
      const result: BetResult = payout > 0 ? 'WIN' : 'LOSS'
      betWrites.push(db.bet.create({
        data: {
          roundId: round.id, userId: user.id, walletId: wallet.id,
          kind: 'PAIR', amount: b.amount, payout, result,
          pairA: b.symbolA, pairB: b.symbolB, cellA: b.cellA, cellB: b.cellB,
          resolvedAt: new Date(),
        },
      }))
    })
    await Promise.all(betWrites)

    await db.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance, version: { increment: 1 } },
    })

    const balanceAfterStake = wallet.balance - totalStake
    await db.transaction.create({
      data: {
        userId: user.id, walletId: wallet.id, type: 'LOSS',
        amount: totalStake, balanceBefore: wallet.balance, balanceAfter: balanceAfterStake,
        status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
        note: 'Self-play round stake',
      },
    })
    if (totalPayout > 0) {
      await db.transaction.create({
        data: {
          userId: user.id, walletId: wallet.id, type: 'WIN',
          amount: totalPayout, balanceBefore: balanceAfterStake, balanceAfter: newBalance,
          status: 'COMPLETED', roundId: round.id, idempotencyKey: crypto.randomUUID(),
          note: 'Self-play round payout',
        },
      })
    }

    return { roundId: round.id }
  })

  // RANDOM rounds resolve immediately — emit one round:resolved event (not the
  // bet-by-bet stream that LIVE uses, since the admin live page only shows LIVE).
  const placedAt = new Date().toISOString()
  notifyAdmin('round:resolved', {
    roundId: result.roundId, mode: 'RANDOM',
    dice: dice as string[], diceSum,
  })
  notifyUser(user.id, 'round:resolved', {
    roundId: result.roundId, mode: 'RANDOM',
    dice: dice as string[], diceSum,
  })

  return Response.json({
    ok: true,
    roundId: result.roundId,
    stake: totalStake,
    payout: totalPayout,
    net: netDelta,
    balance: newBalance,
    placedAt,
  })
}

// ─── LIVE — bets attach to the admin's currently-open BETTING round. Stake is
//   debited now; payouts are credited later when the admin enters the dice on
//   the admin Live page. No dice come from the customer for this mode.
async function handleLiveBets(args: {
  user: { id: string; tel: string; firstName: string | null; lastName: string | null }
  wallet: { id: string; balance: number }
  walletKey: WalletKey
  totalStake: number
  symbolBets: SymbolBetIn[]
  rangeBets: RangeBetIn[]
  pairBets: PairBetIn[]
}) {
  const { user, wallet, totalStake, symbolBets, rangeBets, pairBets } = args

  const openRound = await prisma.gameRound.findFirst({
    where: { mode: 'LIVE', status: 'BETTING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, bettingClosesAt: true },
  })
  if (!openRound) {
    return Response.json({ error: 'No live round is open right now.' }, { status: 409 })
  }
  if (openRound.bettingClosesAt && openRound.bettingClosesAt.getTime() < Date.now()) {
    return Response.json({ error: 'Betting window closed for this round.' }, { status: 409 })
  }

  const balanceAfterStake = wallet.balance - totalStake
  const placedAt = new Date()

  const result = await prisma.$transaction(async db => {
    // Re-read wallet inside the tx to guard against double-spend if the user
    // submits two bet payloads in quick succession.
    const fresh = await db.wallet.findUnique({ where: { id: wallet.id } })
    if (!fresh) throw new Error('Wallet not found.')
    if (fresh.balance < totalStake) throw new Error('Insufficient balance.')

    const newBalance = fresh.balance - totalStake

    const createdBets: Array<{ kind: 'SYMBOL' | 'RANGE' | 'PAIR'; amount: number; symbol: DiceSymbol | null; range: RangeKey | null; pairA: DiceSymbol | null; pairB: DiceSymbol | null }> = []

    for (const b of symbolBets) {
      await db.bet.create({
        data: {
          roundId: openRound.id, userId: user.id, walletId: wallet.id,
          kind: 'SYMBOL', amount: b.amount,
          symbol: b.symbol, cell: b.cell,
        },
      })
      createdBets.push({ kind: 'SYMBOL', amount: b.amount, symbol: b.symbol, range: null, pairA: null, pairB: null })
    }
    for (const b of rangeBets) {
      await db.bet.create({
        data: {
          roundId: openRound.id, userId: user.id, walletId: wallet.id,
          kind: 'RANGE', amount: b.amount, range: b.range,
        },
      })
      createdBets.push({ kind: 'RANGE', amount: b.amount, symbol: null, range: b.range, pairA: null, pairB: null })
    }
    for (const b of pairBets) {
      await db.bet.create({
        data: {
          roundId: openRound.id, userId: user.id, walletId: wallet.id,
          kind: 'PAIR', amount: b.amount,
          pairA: b.symbolA, pairB: b.symbolB, cellA: b.cellA, cellB: b.cellB,
        },
      })
      createdBets.push({ kind: 'PAIR', amount: b.amount, symbol: null, range: null, pairA: b.symbolA, pairB: b.symbolB })
    }

    await db.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance, version: { increment: 1 } },
    })
    await db.transaction.create({
      data: {
        userId: user.id, walletId: wallet.id, type: 'LOSS',
        amount: totalStake, balanceBefore: fresh.balance, balanceAfter: newBalance,
        status: 'COMPLETED', roundId: openRound.id, idempotencyKey: crypto.randomUUID(),
        note: 'Live round stake',
      },
    })

    return { roundId: openRound.id, newBalance, createdBets }
  })

  // Realtime fanout — fire after the DB transaction commits.
  const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
  const placedAtIso = placedAt.toISOString()
  for (const b of result.createdBets) {
    const payload: BetPlacedPayload = {
      roundId: result.roundId, mode: 'LIVE',
      userId: user.id, userTel: user.tel, userName,
      kind: b.kind, amount: b.amount,
      symbol: b.symbol, range: b.range, pairA: b.pairA, pairB: b.pairB,
      createdAt: placedAtIso,
    }
    notifyAdmin('bet:placed', payload)
  }

  return Response.json({
    ok: true,
    roundId: result.roundId,
    stake: totalStake,
    balance: result.newBalance,
    pending: true,  // payouts settled when admin resolves the round
    placedAt: placedAtIso,
  })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
