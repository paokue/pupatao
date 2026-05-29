// Phase-1 of the two-phase RANDOM round flow.
// For REAL/PROMO: resolves the user's self-play phase (advancing it if needed),
// then picks adversarial dice and signs the result so Phase-2 (/api/save-round)
// can trust it. DEMO skips all DB work.
import type { DiceSymbol, RangeKey, SelfPlayPhase } from '@prisma/client'
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

  const cfg = getPayoutConfig()
  let phase: SelfPlayPhase = 'NORMAL'

  if (parsed.wallet !== 'DEMO') {
    const { getCurrentUser } = await import('~/lib/auth.server')
    const { prisma } = await import('~/lib/prisma.server')
    const { getPlayerGameState } = await import('~/lib/player-winnings.server')
    const { resolveAndAdvancePhase } = await import('~/lib/self-play-phase.server')

    let user: Awaited<ReturnType<typeof getCurrentUser>>
    try {
      user = await getCurrentUser(request)
    } catch {
      return Response.json({ error: 'Session error.' }, { status: 503 })
    }
    if (!user) return Response.json({ error: 'Signed out.' }, { status: 401 })

    try {
      // Fetch user record first — if admin-locked, bail out immediately with
      // a guaranteed-loss result without running any other logic.
      const userRecord = await prisma.user.findUnique({
        where: { id: user.id },
        select: { selfPlayPhase: true, selfPlayPhaseBalance: true },
      })

      if (userRecord?.selfPlayPhase === 'ADMIN_LOCKED') {
        // Hard guarantee: admin-locked users always receive 0-payout dice.
        const { pickZeroPayoutDice } = await import('~/lib/game-logic.server')
        const dice = pickZeroPayoutDice(parsed.symbolBets, parsed.rangeBets, parsed.pairBets, cfg)
        const token = signRoundToken({
          dice, wallet: parsed.wallet,
          symbolBets: parsed.symbolBets, rangeBets: parsed.rangeBets, pairBets: parsed.pairBets,
          exp: Date.now() + 120_000,
        })
        return Response.json({ ok: true, dice, token })
      }

      // PROMO self-play: always loses. Promo balance may only be used in live
      // mode (and only when real balance is 0). In self-play it always burns.
      if (parsed.wallet === 'PROMO') {
        const { pickZeroPayoutDice } = await import('~/lib/game-logic.server')
        const dice = pickZeroPayoutDice(parsed.symbolBets, parsed.rangeBets, parsed.pairBets, cfg)
        const token = signRoundToken({
          dice, wallet: parsed.wallet,
          symbolBets: parsed.symbolBets, rangeBets: parsed.rangeBets, pairBets: parsed.pairBets,
          exp: Date.now() + 120_000,
        })
        return Response.json({ ok: true, dice, token })
      }

      // Type B (REAL_LIVE) competition: participants cannot use real wallet in self-play.
      // api.pick-dice is ONLY called for self-play (random) mode, so any REAL wallet
      // bet here from a Type B participant is a violation — return an error.
      if (parsed.wallet === 'REAL') {
        const { getCompetitionConfig } = await import('~/lib/system-settings.server')
        const competition = await getCompetitionConfig()
        if (competition.enabled && competition.type === 'REAL_LIVE') {
          const participant = await prisma.competitionParticipant.findUnique({ where: { userId: user.id } })
          if (participant) {
            return Response.json({ error: 'Real wallet is restricted to live mode during this competition.' }, { status: 403 })
          }
        }
      }

      // Sleep mode: global operator flag that forces all REAL/PROMO rolls to 0
      // payout. Checked after individual lock so the two don't conflict.
      const { getSleepMode } = await import('~/lib/system-settings.server')
      const isSleepMode = await getSleepMode()
      if (isSleepMode) {
        const { pickZeroPayoutDice } = await import('~/lib/game-logic.server')
        const dice = pickZeroPayoutDice(parsed.symbolBets, parsed.rangeBets, parsed.pairBets, cfg)
        const token = signRoundToken({
          dice, wallet: parsed.wallet,
          symbolBets: parsed.symbolBets, rangeBets: parsed.rangeBets, pairBets: parsed.pairBets,
          exp: Date.now() + 120_000,
        })
        return Response.json({ ok: true, dice, token })
      }

      // Not locked — resolve phase via game-state + phase ladder.
      const [gameState, wallet] = await Promise.all([
        getPlayerGameState(user.id),
        prisma.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: parsed.wallet } },
          select: { balance: true },
        }),
      ])

      if (userRecord) {
        const resolved = await resolveAndAdvancePhase(
          user.id,
          { phase: userRecord.selfPlayPhase, phaseEntryBalance: userRecord.selfPlayPhaseBalance },
          wallet?.balance ?? 0,
          gameState.netProfit,
          gameState.lastDepositAmount,
        )
        phase = resolved.phase
      }
    } catch {
      // On DB failure default to the most cautious tier (PHASE_A = 10% win).
      phase = 'PHASE_A'
    }
  }

  const dice = pickAdversarialDice(
    parsed.symbolBets, parsed.rangeBets, parsed.pairBets,
    cfg, parsed.wallet as WalletType, phase,
  )

  const token = signRoundToken({
    dice,
    wallet: parsed.wallet,
    symbolBets: parsed.symbolBets,
    rangeBets:  parsed.rangeBets,
    pairBets:   parsed.pairBets,
    exp: Date.now() + 120_000,
  })

  return Response.json({ ok: true, dice, token })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
