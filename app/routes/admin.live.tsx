import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Check, Loader, Lock, PlayCircle, Radio, Square, Users as UsersIcon, X } from 'lucide-react'
import type { DiceSymbol } from '@prisma/client'
import type { Route } from './+types/admin.live'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyGame, notifyPresenceLive, notifyUser } from '~/lib/pusher.server'
import { getPayoutConfig, type PayoutConfig } from '~/lib/payouts.server'
import { liveBetPotentialReturn, LOCKED_LIVE_VOID_RETURN_MIN } from '~/lib/game-logic.server'
import { useT } from '~/lib/use-t'
import { t as translate, parseLocaleCookie } from '~/lib/i18n'
import {
  getLiveSchedule, getLiveStreamUrl, setLiveSchedule, setLiveStreamUrl,
  LIVE_BETTING_SECONDS_KEY,
} from '~/lib/system-settings.server'
import {
  ADMIN_CHANNEL,
  PRESENCE_LIVE,
  type BetPlacedPayload,
  type RewardCreditedPayload,
  type RoundDicePayload,
  type RoundResolvedPayload,
} from '~/lib/pusher-channels'
import { usePresenceMembers, usePusherEvent } from '~/hooks/use-pusher'

const SYMBOL_VALUE: Record<DiceSymbol, number> = {
  PRAWN: 1, FISH: 2, CRAB: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
}
const RANGE_BOUNDS: Record<'LOW' | 'MIDDLE' | 'HIGH', { min: number; max: number }> = {
  LOW: { min: 3, max: 8 },
  MIDDLE: { min: 9, max: 10 },
  HIGH: { min: 11, max: 18 },
}

// SUM numbers that earn the special bonus payout (×5 total return) in live mode.
const SPECIAL_SUMS = new Set([3, 7, 11, 15])

type LivePromo = { sum: boolean }

// Mirrors the per-bet payout math in api.play-round.tsx so server-side resolve
// Retries a transaction on MongoDB transient write-conflict / deadlock errors
// (Prisma code P2034). These happen when a concurrent write touches a document
// the transaction is modifying — e.g. a bettor playing self-play while a LIVE
// round settle credits their wallet. The transaction aborts atomically on
// conflict (nothing committed), so re-running the whole thing is safe and never
// double-credits. Uses exponential backoff with jitter.
async function withWriteConflictRetry<T>(fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as { code?: string })?.code
      const msg = String((e as { message?: string })?.message ?? '')
      const isTransient = code === 'P2034' || /write conflict|deadlock|please retry/i.test(msg)
      if (!isTransient || attempt >= maxAttempts - 1) throw e
      await new Promise(r => setTimeout(r, 60 * 2 ** attempt + Math.floor(Math.random() * 60)))
    }
  }
}

// produces the same numbers as a client-rolled RANDOM round would.
// Multipliers come from getPayoutConfig() so a single env change tunes both.
// `livePromo` is only passed for LIVE-mode settlements to apply promotion bonuses.
function computeBetPayout(
  b: { kind: string; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; exactSum?: number | null },
  dice: DiceSymbol[],
  diceSum: number,
  cfg: PayoutConfig,
  livePromo?: LivePromo,
): number {
  if (b.kind === 'SYMBOL' && b.symbol) {
    const matches = dice.filter(d => d === b.symbol).length
    if (matches === 1) return b.amount * cfg.symbol1
    if (matches === 2) return b.amount * cfg.symbol2
    // 3 matches pays the standard symbol3 multiplier (no triple bonus) — e.g.
    // ×4 total: a 30,000 bet on FISH with three FISH pays 120,000.
    if (matches === 3) return b.amount * cfg.symbol3
    return 0
  }
  if (b.kind === 'RANGE' && b.range) {
    const bounds = RANGE_BOUNDS[b.range as 'LOW' | 'MIDDLE' | 'HIGH']
    if (!bounds) return 0
    if (diceSum < bounds.min || diceSum > bounds.max) return 0
    const mul = b.range === 'LOW' ? cfg.rangeLow : b.range === 'MIDDLE' ? cfg.rangeMiddle : cfg.rangeHigh
    return b.amount * mul
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    return dice.includes(b.pairA as DiceSymbol) && dice.includes(b.pairB as DiceSymbol)
      ? b.amount * cfg.pair
      : 0
  }
  if (b.kind === 'SUM' && b.exactSum != null) {
    if (diceSum === b.exactSum) {
      // Special SUM numbers (3, 7, 11, 15) pay ×5 net profit = ×6 total return; others keep cfg.sumNumber
      if (livePromo?.sum && SPECIAL_SUMS.has(b.exactSum)) return b.amount * 6
      return b.amount * cfg.sumNumber
    }
    return 0
  }
  return 0
}
// Asset filenames live at /symbols/<lowercase>.png — same files the player view uses.
const SYMBOL_FILE: Record<DiceSymbol, string> = {
  FISH: 'fish', PRAWN: 'prawn', CRAB: 'crab', ROOSTER: 'rooster', GOURD: 'gourd', FROG: 'frog',
}
const SYMBOLS: DiceSymbol[] = ['FISH', 'PRAWN', 'CRAB', 'ROOSTER', 'GOURD', 'FROG']

function symbolSrc(s: DiceSymbol): string {
  return `/symbols/${SYMBOL_FILE[s]}.png`
}

// Scores every dice result by what it would pay out against the current bets,
// to help the admin pick a low-exposure outcome on a LIVE round. Only enumerates
// combos of 3 DISTINCT symbols (no pairs/triples) since duplicate dice are
// avoided in live play. Returns all combos sorted cheapest→priciest; the caller
// slices the lowest few (safe picks) and highest few (avoid). Pure/client-safe.
type PayoutCombo = { dice: DiceSymbol[]; payout: number; diceSum: number }
type ScorableBet = { kind: string; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; exactSum?: number | null }
function rankCombosByPayout(bets: ScorableBet[], cfg: PayoutConfig, livePromo: LivePromo): PayoutCombo[] {
  const combos: PayoutCombo[] = []
  for (let i = 0; i < SYMBOLS.length; i++) {
    for (let j = i + 1; j < SYMBOLS.length; j++) {
      for (let k = j + 1; k < SYMBOLS.length; k++) {
        const dice = [SYMBOLS[i], SYMBOLS[j], SYMBOLS[k]]
        const diceSum = SYMBOL_VALUE[dice[0]] + SYMBOL_VALUE[dice[1]] + SYMBOL_VALUE[dice[2]]
        let payout = 0
        for (const b of bets) payout += computeBetPayout(b, dice, diceSum, cfg, livePromo)
        combos.push({ dice, payout, diceSum })
      }
    }
  }
  // Lowest payout first; tie-break by sum so the order is stable.
  combos.sort((a, b) => a.payout - b.payout || a.diceSum - b.diceSum)
  return combos
}

// Total money riding on each of the 6 symbols across SYMBOL + PAIR bets (RANGE
// and SUM bets don't reference a symbol). Every symbol is present, defaulting to
// 0 — so callers can read off both the most-bet die and the zero-bet dice.
function symbolExposure(bets: ScorableBet[]): Map<DiceSymbol, number> {
  const totals = new Map<DiceSymbol, number>()
  for (const s of SYMBOLS) totals.set(s, 0)
  for (const b of bets) {
    for (const s of [b.symbol, b.pairA, b.pairB]) {
      if (s && (SYMBOLS as string[]).includes(s)) totals.set(s as DiceSymbol, (totals.get(s as DiceSymbol) ?? 0) + b.amount)
    }
  }
  return totals
}
const ACTIVE_STATUSES = ['BETTING', 'LOCKED', 'AWAITING_RESULT'] as const

const DEFAULT_BETTING_SECONDS = 60

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  // The most recent round that is still in flight, if any.
  const current = await prisma.gameRound.findFirst({
    where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      host: { select: { email: true, firstName: true, lastName: true } },
      _count: { select: { bets: true } },
    },
  })

  // Bets already placed in the current round — seeds the realtime feed.
  // Admin always sees every bet (including ADMIN_LOCKED users' high-value bets —
  // those are hidden only on the customer's own screen, and voided at settle).
  const currentBets = current
    ? await prisma.bet.findMany({
      where: { roundId: current.id, wallet: { type: { in: ['REAL', 'PROMO'] } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { tel: true, firstName: true, lastName: true } },
        wallet: { select: { type: true } },
      },
    })
    : []

  // Round history — most recent finished/cancelled rounds (and any extra
  // active ones not picked up above, just in case more than one was opened).
  // Fetch 101 to determine `hasMore` without an extra query — the 101st row
  // is dropped from the rendered list.
  const HISTORY_PAGE_SIZE = 100
  const historyPage = await prisma.gameRound.findMany({
    where: { mode: 'LIVE', NOT: current ? { id: current.id } : undefined },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_PAGE_SIZE + 1,
    include: {
      host: { select: { email: true, firstName: true, lastName: true } },
      _count: { select: { bets: true } },
    },
  })
  const history = historyPage.slice(0, HISTORY_PAGE_SIZE)
  const historyHasMore = historyPage.length > HISTORY_PAGE_SIZE

  // Prefill stream URL with the last one we saw, so admin doesn't retype it.
  const lastWithStream = await prisma.gameRound.findFirst({
    where: { mode: 'LIVE', streamUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { streamUrl: true },
  })

  const [liveStreamUrl, schedule, bettingSecondsSetting] = await Promise.all([
    getLiveStreamUrl(),
    getLiveSchedule(),
    prisma.systemSetting.findUnique({ where: { key: LIVE_BETTING_SECONDS_KEY }, select: { value: true } }),
  ])
  const savedBettingSeconds = bettingSecondsSetting ? parseInt(bettingSecondsSetting.value, 10) || DEFAULT_BETTING_SECONDS : DEFAULT_BETTING_SECONDS

  function serialize(r: typeof history[number]) {
    return {
      id: r.id,
      status: r.status,
      streamUrl: r.streamUrl,
      // createdAt is the cursor field used by /api/admin/live-history to
      // load older pages, so it must round-trip through the JSON payload.
      createdAt: r.createdAt.toISOString(),
      bettingOpensAt: r.bettingOpensAt.toISOString(),
      bettingClosesAt: r.bettingClosesAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      dice1: r.dice1,
      dice2: r.dice2,
      dice3: r.dice3,
      diceSum: r.diceSum,
      host: r.host
        ? [r.host.firstName, r.host.lastName].filter(Boolean).join(' ') || r.host.email
        : null,
      bets: r._count.bets,
    }
  }

  return {
    current: current ? serialize(current) : null,
    currentBets: currentBets.map(b => ({
      id: b.id,
      kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM',
      amount: b.amount,
      symbol: b.symbol,
      range: b.range,
      pairA: b.pairA,
      pairB: b.pairB,
      exactSum: b.exactSum,
      createdAt: b.createdAt.toISOString(),
      userId: b.userId,
      userTel: b.user.tel,
      userName: [b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || null,
      walletType: b.wallet.type as 'REAL' | 'PROMO',
    })),
    history: history.map(serialize),
    historyHasMore,
    lastStreamUrl: lastWithStream?.streamUrl ?? '',
    liveStreamUrl,
    schedule,
    savedBettingSeconds,
    // Payout multipliers + LIVE promo flags so the admin result-entry modal can
    // compute (client-side) which dice combos pay out the least.
    payoutCfg: getPayoutConfig(),
    livePromo: { sum: process.env.PROMO_SUM === 'true' },
  }
}

// Shape used by both the seeded bets (from the loader) and the realtime feed.
type LiveBet = {
  id: string
  kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  exactSum?: number | null
  createdAt: string
  userId: string
  userTel: string
  userName: string | null
  walletType: 'DEMO' | 'REAL' | 'PROMO'
}

// Facebook "share" URLs (facebook.com/share/v/<shortcode>/ and fb.watch/<x>)
// don't embed via the video plugin — the plugin only accepts canonical URLs
// in the form facebook.com/<page>/videos/<id>. Each share URL 302s to the
// canonical, so we follow the redirect once and store the canonical form.
//
// Falls back to returning the input unchanged on any failure (network error,
// non-Facebook URL, blocked by FB, etc.) so a hiccup never prevents the admin
// from starting a round.
async function normalizeStreamUrl(raw: string | null): Promise<string | null> {
  if (!raw) return raw
  const isFbShare = /^https?:\/\/(www\.)?facebook\.com\/share\/v\//i.test(raw) || /^https?:\/\/fb\.watch\//i.test(raw)
  if (!isFbShare) return raw
  try {
    // HEAD with redirect:'manual' so we read the Location header instead of
    // walking the whole chain (one hop is enough — Facebook resolves directly
    // to the canonical /<page>/videos/<id> URL).
    const res = await fetch(raw, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 PupataoBot/1.0' },
    })
    const loc = res.headers.get('location')
    if (!loc) return raw
    // Strip the noisy `?rdid=...&share_url=...` query — the plugin doesn't
    // need it and the cleaner URL is nicer to look at in the admin form.
    const u = new URL(loc)
    u.search = ''
    return u.toString()
  } catch (err) {
    console.warn('[admin/live] normalizeStreamUrl failed, using raw url', err)
    return raw
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  // Errors translated server-side from the locale cookie (actions can't use the hook).
  const locale = parseLocaleCookie(request.headers.get('cookie'))
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')

  try {
    if (op === 'startRound') {
      // Refuse if a round is already in flight.
      const existing = await prisma.gameRound.findFirst({
        where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } },
        select: { id: true },
      })
      if (existing) return { error: translate(locale, 'admin.live.action.roundInFlight') }

      const rawStreamUrl = String(fd.get('streamUrl') ?? '').trim() || null
      const streamUrl = await normalizeStreamUrl(rawStreamUrl)
      const seconds = Math.max(15, Math.min(600, parseInt(String(fd.get('seconds') ?? DEFAULT_BETTING_SECONDS), 10) || DEFAULT_BETTING_SECONDS))
      const bettingClosesAt = new Date(Date.now() + seconds * 1000)

      const round = await prisma.gameRound.create({
        data: {
          mode: 'LIVE',
          status: 'BETTING',
          hostId: admin.id,
          streamUrl,
          bettingClosesAt,
        },
      })
      await Promise.all([
        prisma.auditLog.create({
          data: { actorId: admin.id, action: 'round.start', target: `round:${round.id}`, metadata: { seconds, streamUrl } },
        }),
        // Set the global live stream URL so customers see the stream between rounds
        setLiveStreamUrl(streamUrl, admin.id),
        // Clear the schedule — we're live now, no countdown needed
        setLiveSchedule(null, null, admin.id),
        // Persist the betting window so the form remembers it next round
        prisma.systemSetting.upsert({
          where: { key: LIVE_BETTING_SECONDS_KEY },
          create: { key: LIVE_BETTING_SECONDS_KEY, value: String(seconds), updatedBy: admin.id },
          update: { value: String(seconds), updatedBy: admin.id },
        }),
      ])
      const startedPayload = {
        roundId: round.id,
        streamUrl: streamUrl,
        bettingClosesAt: bettingClosesAt.toISOString(),
      }
      // Broadcast to every channel so every open customer page (presence-live,
      // plus the public game channel for self-play players) and every admin
      // tab (private-admin) revalidates without a manual refresh.
      notifyPresenceLive('round:started', startedPayload)
      notifyAdmin('round:started', startedPayload)
      notifyGame('round:started', startedPayload)
      return { ok: true }
    }

    // These ops don't need a roundId — handle them before the roundId gate.
    if (op === 'endLive') {
      await setLiveStreamUrl(null, admin.id)
      notifyPresenceLive('live:ended', {})
      notifyAdmin('live:ended', {})
      notifyGame('live:ended', {})
      return { ok: true }
    }

    if (op === 'setSchedule') {
      const dateStr  = String(fd.get('scheduleDate')  ?? '').trim()
      const startStr = String(fd.get('scheduleStart') ?? '').trim()
      const endStr   = String(fd.get('scheduleEnd')   ?? '').trim()
      const notice   = String(fd.get('scheduleNotice') ?? '').trim() || null
      if (!dateStr || !startStr || !endStr) return { error: translate(locale, 'admin.live.action.scheduleFieldsRequired') }
      const start = new Date(`${dateStr}T${startStr}:00+07:00`)
      const end   = new Date(`${dateStr}T${endStr}:00+07:00`)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return { error: translate(locale, 'admin.live.action.invalidDateTime') }
      if (end <= start) return { error: translate(locale, 'admin.live.action.endAfterStart') }
      const startIso = start.toISOString()
      const endIso   = end.toISOString()
      await setLiveSchedule(startIso, endIso, admin.id, notice)
      const schedPayload = { start: startIso, end: endIso }
      notifyPresenceLive('live:scheduled', schedPayload)
      notifyAdmin('live:scheduled', schedPayload)
      return { ok: true }
    }

    if (op === 'clearSchedule') {
      await setLiveSchedule(null, null, admin.id, null)
      const schedPayload = { start: null, end: null }
      notifyPresenceLive('live:scheduled', schedPayload)
      notifyAdmin('live:scheduled', schedPayload)
      return { ok: true }
    }

    const roundId = String(fd.get('roundId') ?? '')
    if (!roundId) return { error: translate(locale, 'admin.live.action.roundIdRequired') }

    const round = await prisma.gameRound.findUnique({ where: { id: roundId } })
    if (!round) return { error: translate(locale, 'admin.live.action.roundNotFound') }

    if (op === 'updateStream') {
      const rawStreamUrl = String(fd.get('streamUrl') ?? '').trim() || null
      const streamUrl = await normalizeStreamUrl(rawStreamUrl)
      await Promise.all([
        prisma.gameRound.update({ where: { id: roundId }, data: { streamUrl } }),
        setLiveStreamUrl(streamUrl, admin.id),
      ])
      // Broadcast so every open customer page revalidates and switches to the
      // new feed without waiting for a manual refresh.
      const payload = { roundId, streamUrl }
      notifyPresenceLive('round:streamUpdated', payload)
      notifyAdmin('round:streamUpdated', payload)
      return { ok: true }
    }

    if (op === 'lock') {
      if (round.status !== 'BETTING') return { error: translate(locale, 'admin.live.action.onlyOpenLockable') }
      await prisma.$transaction([
        prisma.gameRound.update({
          where: { id: roundId },
          data: { status: 'AWAITING_RESULT', bettingClosesAt: new Date() },
        }),
        prisma.auditLog.create({
          data: { actorId: admin.id, action: 'round.lock', target: `round:${roundId}` },
        }),
      ])
      return { ok: true }
    }

    // Persist a single die pick so customers can watch the result fill in
    // one slot at a time. Admin can re-click to change a die before SUMMARY.
    if (op === 'revealDie') {
      if (round.status === 'RESOLVED' || round.status === 'CANCELLED') {
        return { error: translate(locale, 'admin.live.action.roundFinalised') }
      }
      const dieIndexRaw = String(fd.get('dieIndex') ?? '')
      const symbol = String(fd.get('symbol') ?? '') as DiceSymbol
      if (dieIndexRaw !== '1' && dieIndexRaw !== '2' && dieIndexRaw !== '3') {
        return { error: translate(locale, 'admin.live.action.invalidDieIndex') }
      }
      if (!SYMBOLS.includes(symbol)) return { error: translate(locale, 'admin.live.action.invalidSymbol') }
      const field = (`dice${dieIndexRaw}` as 'dice1' | 'dice2' | 'dice3')
      await prisma.gameRound.update({ where: { id: roundId }, data: { [field]: symbol } })
      const payload = {
        roundId,
        dieIndex: parseInt(dieIndexRaw, 10) as 1 | 2 | 3,
        symbol: symbol as string,
      }
      notifyPresenceLive('round:dice', payload)
      notifyAdmin('round:dice', payload)
      return { ok: true }
    }

    if (op === 'resolve') {
      if (round.status === 'RESOLVED' || round.status === 'CANCELLED') {
        return { error: translate(locale, 'admin.live.action.roundFinalised') }
      }
      // Dice come from the DB now (set incrementally via `revealDie`), so the
      // settlement payload no longer carries them. Refresh the round to pick
      // up any picks made since the action started.
      const fresh = await prisma.gameRound.findUnique({ where: { id: roundId }, select: { dice1: true, dice2: true, dice3: true } })
      const dice1 = fresh?.dice1 as DiceSymbol | null
      const dice2 = fresh?.dice2 as DiceSymbol | null
      const dice3 = fresh?.dice3 as DiceSymbol | null
      if (!dice1 || !dice2 || !dice3 || !SYMBOLS.includes(dice1) || !SYMBOLS.includes(dice2) || !SYMBOLS.includes(dice3)) {
        return { error: translate(locale, 'admin.live.action.pickAllDice') }
      }
      const diceSum = SYMBOL_VALUE[dice1] + SYMBOL_VALUE[dice2] + SYMBOL_VALUE[dice3]
      const dice = [dice1, dice2, dice3] as DiceSymbol[]

      // Pull all (still-unsettled) bets attached to this round and compute
      // their payouts against the dice the admin just entered. Stakes were
      // already debited at bet-placement time; we credit each bettor's wallet
      // with the sum of their wins here.
      //
      // We deliberately don't filter by `result: null` — Prisma+MongoDB
      // doesn't match docs where the field is *absent* (only explicit nulls),
      // so freshly-created LIVE bets (which never set `result`) wouldn't be
      // picked up. Double-settlement is already prevented by the round-status
      // guard above.
      const bets = await prisma.bet.findMany({
        where: { roundId },
        select: { id: true, userId: true, walletId: true, kind: true, amount: true, symbol: true, range: true, pairA: true, pairB: true, exactSum: true, user: { select: { tel: true, firstName: true, lastName: true, selfPlayPhase: true } }, wallet: { select: { type: true } } },
      })

      const cfg = getPayoutConfig()
      const livePromo: LivePromo = {
        sum: process.env.PROMO_SUM === 'true',
      }
      const promoStreak = process.env.PROMO_STREAK === 'true'

      // Locked-user round-level void rule:
      //  • A "big" bet = an ADMIN_LOCKED user's bet whose potential WINNINGS
      //    (return − stake) would be MORE THAN 500,000 ₭.
      //  • If a user has ≥1 big bet AND a big bet actually WINS this round, ALL
      //    of that user's bets are voided + refunded (marked REFUNDED).
      //  • Otherwise (no big bet, or all big bets lost) every bet settles normally.
      const promoSum = livePromo.sum
      const userHasBigBet = new Set<string>()       // user placed a >500k-profit bet
      const userBigBetWon = new Set<string>()       // one of those big bets won
      for (const b of bets) {
        if (b.user.selfPlayPhase !== 'ADMIN_LOCKED') continue
        const potentialProfit = liveBetPotentialReturn(b, cfg, { promoSum }) - b.amount
        if (potentialProfit <= LOCKED_LIVE_VOID_RETURN_MIN) continue
        userHasBigBet.add(b.userId)
        if (computeBetPayout(b, dice, diceSum, cfg, livePromo) > 0) userBigBetWon.add(b.userId)
      }
      // Users whose entire round is refunded: had a big bet, and it won.
      const refundUserIds = new Set([...userHasBigBet].filter(uid => userBigBetWon.has(uid)))

      type Resolved = { id: string; payout: number; result: 'WIN' | 'LOSS' | 'REFUNDED' }
      const betUpdates: Resolved[] = bets.map(b => {
        if (refundUserIds.has(b.userId)) {
          // Refund every bet for this user this round (stake returned, no payout).
          return { id: b.id, payout: b.amount, result: 'REFUNDED' as const }
        }
        const payout = computeBetPayout(b, dice, diceSum, cfg, livePromo)
        return { id: b.id, payout, result: payout > 0 ? 'WIN' : 'LOSS' }
      })

      // Per-player aggregates — used both for the wallet credits and the
      // admin summary panel. Grouped by (userId, walletId) so a player betting
      // from multiple wallets in the same round is settled correctly.
      // `winningStake` only counts the stake portion of winning bets, which
      // is what PROMO refunds to the source wallet (profit goes to REAL).
      type Group = {
        userId: string
        walletId: string
        walletType: 'DEMO' | 'REAL' | 'PROMO'
        userTel: string
        userName: string | null
        stake: number          // sum of all stakes this user placed in this wallet
        winningStake: number   // sum of stakes of winning bets
        payout: number         // sum of gross payouts of winning bets (stake + profit)
        refund: number         // sum of stakes of voided (locked high-value) bets to return
      }
      const playerGroups = new Map<string, Group>()
      bets.forEach((b, i) => {
        const u = betUpdates[i]
        const key = `${b.userId}:${b.walletId}`
        let grp = playerGroups.get(key)
        if (!grp) {
          grp = {
            userId: b.userId,
            walletId: b.walletId,
            walletType: b.wallet.type as 'DEMO' | 'REAL' | 'PROMO',
            userTel: b.user.tel,
            userName: [b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || null,
            stake: 0,
            winningStake: 0,
            payout: 0,
            refund: 0,
          }
          playerGroups.set(key, grp)
        }
        if (u.result === 'REFUNDED') {
          grp.refund += b.amount
          return // voided bet: neither stake-at-risk nor win/loss
        }
        grp.stake += b.amount
        if (u.payout > 0) {
          grp.winningStake += b.amount
          grp.payout += u.payout
        }
      })

      const resolvedAt = new Date()
      // Keep ONLY money-critical work inside the interactive transaction: the
      // round-status flip (the double-settle guard) plus the wallet credits and
      // their WIN ledger rows. The per-bet result writes and the audit log are
      // independent of the money math and are applied in parallel AFTER commit —
      // this keeps the transaction short so it doesn't hit the 30s timeout on a
      // busy round (many bets/players × Atlas round-trip latency).
      const newBalances = await withWriteConflictRetry(() => prisma.$transaction(async db => {
        await db.gameRound.update({
          where: { id: roundId },
          data: { status: 'RESOLVED', dice1, dice2, dice3, diceSum, resolvedAt },
        })
        const balances: Record<string, number> = {}
        for (const grp of playerGroups.values()) {
          const w = await db.wallet.findUnique({ where: { id: grp.walletId } })
          if (!w) continue
          let bal = w.balance

          // Refund voided (locked high-value) bets to the SOURCE wallet first,
          // so the running balance below already includes the returned stake.
          if (grp.refund > 0) {
            const afterRefund = bal + grp.refund
            await db.wallet.update({
              where: { id: grp.walletId },
              data: { balance: afterRefund, version: { increment: 1 } },
            })
            await db.transaction.create({
              data: {
                userId: grp.userId, walletId: grp.walletId, type: 'ADJUSTMENT',
                amount: grp.refund, balanceBefore: bal, balanceAfter: afterRefund,
                status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
                note: `Live bet failed — stake refunded (#${roundId.slice(-6)})`,
              },
            })
            bal = afterRefund
          }

          balances[grp.userId] = bal  // default to balance after any refund (no win)
          if (grp.payout <= 0) continue

          if (grp.walletType === 'PROMO') {
            // PROMO rule: refund winning stakes to PROMO; credit profit to REAL.
            const profit = grp.payout - grp.winningStake
            const newPromoBalance = bal + grp.winningStake
            if (grp.winningStake > 0) {
              await db.wallet.update({
                where: { id: grp.walletId },
                data: { balance: newPromoBalance, version: { increment: 1 } },
              })
              await db.transaction.create({
                data: {
                  userId: grp.userId, walletId: grp.walletId, type: 'WIN',
                  amount: grp.winningStake, balanceBefore: bal, balanceAfter: newPromoBalance,
                  status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
                  note: `Live round — PROMO stake refund (#${roundId.slice(-6)})`,
                },
              })
            }
            if (profit > 0) {
              const realWallet = await db.wallet.findUnique({
                where: { userId_type: { userId: grp.userId, type: 'REAL' } },
              })
              if (realWallet) {
                const newRealBalance = realWallet.balance + profit
                await db.wallet.update({
                  where: { id: realWallet.id },
                  data: { balance: newRealBalance, version: { increment: 1 } },
                })
                await db.transaction.create({
                  data: {
                    userId: grp.userId, walletId: realWallet.id, type: 'WIN',
                    amount: profit, balanceBefore: realWallet.balance, balanceAfter: newRealBalance,
                    status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
                    note: `Live round — PROMO profit credited to REAL (#${roundId.slice(-6)})`,
                  },
                })
              }
            }
            // For settlement summary purposes, "newBalance" reports the source
            // (PROMO) wallet's resulting balance, not REAL — matches DEMO/REAL.
            balances[grp.userId] = newPromoBalance
          } else {
            const newBalance = bal + grp.payout
            await db.wallet.update({
              where: { id: grp.walletId },
              data: { balance: newBalance, version: { increment: 1 } },
            })
            await db.transaction.create({
              data: {
                userId: grp.userId, walletId: grp.walletId, type: 'WIN',
                amount: grp.payout, balanceBefore: bal, balanceAfter: newBalance,
                status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
                note: `Live round payout (#${roundId.slice(-6)})`,
              },
            })
            balances[grp.userId] = newBalance
          }
        }
        return balances
      }, { timeout: 60000, maxWait: 15000 }))

      // Non-money-critical follow-ups, run in parallel outside the transaction.
      // The round is already RESOLVED (settle is idempotent via the status
      // guard), so a failure here can't double-credit — it would only leave a
      // bet row's result unset, which doesn't affect balances.
      // Per-bet result writes are best-effort and individually guarded — a single
      // write failure must NOT abort settlement (the money already committed) nor
      // block the round:settled events below (which drive the customer's modal).
      await Promise.allSettled([
        ...betUpdates.map(u =>
          prisma.bet.update({
            where: { id: u.id },
            data: { payout: u.payout, result: u.result, resolvedAt },
          }).catch(err => { console.error('[round.resolve] bet result write failed', u.id, err) })
        ),
        prisma.auditLog.create({
          data: {
            actorId: admin.id,
            action: 'round.resolve',
            target: `round:${roundId}`,
            metadata: { dice1, dice2, dice3, diceSum, bets: bets.length, players: playerGroups.size },
          },
        }).catch(() => {}),
      ])

      // Build per-user bet lists for the round:settled events. The customer's
      // result modal renders one row per bet so they see exactly what they
      // placed and how each bet resolved.
      const perUserBets = new Map<string, { kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; exactSum: number | null; payout: number; result: 'WIN' | 'LOSS' | 'REFUNDED' }[]>()
      bets.forEach((b, i) => {
        const u = betUpdates[i]
        const list = perUserBets.get(b.userId) ?? []
        list.push({
          kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM',
          amount: b.amount,
          symbol: b.symbol,
          range: b.range,
          pairA: b.pairA,
          pairB: b.pairB,
          exactSum: b.exactSum ?? null,
          payout: u.payout,
          result: u.result,
        })
        perUserBets.set(b.userId, list)
      })

      const resolvedPayload = { roundId, mode: 'LIVE' as const, dice: dice as string[], diceSum }
      notifyAdmin('round:resolved', resolvedPayload)
      notifyPresenceLive('round:resolved', resolvedPayload)
      for (const grp of playerGroups.values()) {
        const newBalance = newBalances[grp.userId] ?? 0
        notifyUser(grp.userId, 'round:settled', {
          roundId,
          dice: dice as string[],
          diceSum,
          stake: grp.stake,
          payout: grp.payout,
          net: grp.payout - grp.stake,
          newBalance,
          bets: perUserBets.get(grp.userId) ?? [],
        })
        notifyUser(grp.userId, 'transaction:updated', {
          id: `round:${roundId}`,
          status: 'COMPLETED',
          type: 'DEPOSIT',
          amount: 0,
          balanceAfter: newBalance,
          note: grp.payout > 0 ? 'Live round payout' : 'Live round settled',
        })
      }

      // ── Win-streak promotion ──────────────────────────────────────────────
      // For each non-DEMO bettor: tally net across all their wallets, update
      // liveWinStreak, and credit a bonus if they hit streak 4 or 5.
      if (promoStreak) {
        const userNet = new Map<string, { stake: number; payout: number }>()
        for (const grp of playerGroups.values()) {
          if (grp.walletType === 'DEMO') continue
          const cur = userNet.get(grp.userId) ?? { stake: 0, payout: 0 }
          cur.stake  += grp.stake
          cur.payout += grp.payout
          userNet.set(grp.userId, cur)
        }
        for (const [userId, net] of userNet) {
          const won = net.payout > net.stake
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { liveWinStreak: true } })
          if (!user) continue
          const oldStreak = user.liveWinStreak
          let newStreak = won ? oldStreak + 1 : 0
          let bonusAmount = 0
          let bonusNote = ''
          if (won && newStreak === 4) {
            bonusAmount = 5000
            bonusNote = 'ຂອງຂວັນຊະນະ 4 ຕາຊ້ອນ'
          } else if (won && newStreak === 5) {
            bonusAmount = 10000
            bonusNote = 'ຂອງຂວັນຊະນະ 5 ຕາຊ້ອນ'
            newStreak = 0  // reset — next win starts fresh at 1
          }
          await prisma.user.update({ where: { id: userId }, data: { liveWinStreak: newStreak } })
          if (bonusAmount > 0) {
            try {
              // Re-fetch the REAL wallet so balance reflects post-settlement payout.
              const realWallet = await prisma.wallet.findUnique({
                where: { userId_type: { userId, type: 'REAL' } },
              })
              if (!realWallet) throw new Error(`REAL wallet not found for user ${userId}`)
              const balanceBefore = realWallet.balance
              const newRealBalance = balanceBefore + bonusAmount
              await prisma.$transaction([
                prisma.wallet.update({
                  where: { id: realWallet.id },
                  data: { balance: newRealBalance, version: { increment: 1 } },
                }),
                prisma.transaction.create({
                  data: {
                    userId, walletId: realWallet.id, type: 'SYSTEM_REWARD',
                    amount: bonusAmount,
                    balanceBefore,
                    balanceAfter: newRealBalance,
                    status: 'COMPLETED',
                    idempotencyKey: crypto.randomUUID(),
                    note: bonusNote,
                  },
                }),
              ])
              notifyUser(userId, 'reward:credited', {
                amount: bonusAmount,
                note: bonusNote,
                newBalance: newRealBalance,
                streak: oldStreak + 1,
              } satisfies RewardCreditedPayload)
            } catch (err) {
              console.error('[promo] streak bonus credit failed for user', userId, err)
            }
          }
        }
      }

      // Build the summary payload that the admin's UI panel renders.
      // Real-money view only: DEMO wallets are excluded so the totals reflect
      // actual REAL/PROMO exposure (DEMO is play-money and shouldn't skew the
      // house net / stake / payout figures).
      const players = Array.from(playerGroups.values())
        .filter(grp => grp.walletType !== 'DEMO')
        .map(grp => ({
          userId: grp.userId,
          userTel: grp.userTel,
          userName: grp.userName,
          stake: grp.stake,
          payout: grp.payout,
          net: grp.payout - grp.stake,
          newBalance: newBalances[grp.userId] ?? 0,
        }))
      const totalStake = players.reduce((s, p) => s + p.stake, 0)
      const totalPayout = players.reduce((s, p) => s + p.payout, 0)
      const realPromoBetCount = bets.filter(b => b.wallet.type !== 'DEMO').length

      return {
        ok: true,
        summary: {
          roundId,
          dice: dice as string[],
          diceSum,
          totalBets: realPromoBetCount,
          totalPlayers: players.length,
          totalStake,
          totalPayout,
          houseNet: totalStake - totalPayout,  // positive = house won
          players,
        },
      }
    }

    if (op === 'cancel') {
      if (round.status === 'RESOLVED' || round.status === 'CANCELLED') {
        return { error: translate(locale, 'admin.live.action.roundFinalised') }
      }
      // Refund every bet's stake back to the bettor's wallet.
      // (No `result: null` filter — see the resolve action above for why.)
      const bets = await prisma.bet.findMany({
        where: { roundId },
        select: { id: true, userId: true, walletId: true, amount: true },
      })
      type RefundGroup = { userId: string; walletId: string; refund: number }
      const refundGroups = new Map<string, RefundGroup>()
      for (const b of bets) {
        const key = `${b.userId}:${b.walletId}`
        const existing = refundGroups.get(key)
        if (existing) existing.refund += b.amount
        else refundGroups.set(key, { userId: b.userId, walletId: b.walletId, refund: b.amount })
      }

      const refundedBalances = await withWriteConflictRetry(() => prisma.$transaction(async db => {
        await db.gameRound.update({
          where: { id: roundId },
          data: { status: 'CANCELLED', resolvedAt: new Date() },
        })
        // Mark bets as LOSS with payout 0 to preserve them for audit.
        if (bets.length > 0) {
          await db.bet.updateMany({
            where: { roundId },
            data: { payout: 0, result: 'LOSS', resolvedAt: new Date() },
          })
        }
        const balances: Record<string, number> = {}
        for (const grp of refundGroups.values()) {
          const w = await db.wallet.findUnique({ where: { id: grp.walletId } })
          if (!w) continue
          const newBalance = w.balance + grp.refund
          await db.wallet.update({
            where: { id: grp.walletId },
            data: { balance: newBalance, version: { increment: 1 } },
          })
          await db.transaction.create({
            data: {
              userId: grp.userId, walletId: grp.walletId, type: 'ADJUSTMENT',
              amount: grp.refund, balanceBefore: w.balance, balanceAfter: newBalance,
              status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
              note: `Live round cancelled — stake refund (#${roundId.slice(-6)})`,
            },
          })
          balances[grp.userId] = newBalance
        }
        return balances
      }, { timeout: 60000, maxWait: 15000 }))

      // Audit log is non-money-critical — write it outside the transaction.
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'round.cancel', target: `round:${roundId}`, metadata: { refundedBets: bets.length, refundedWallets: refundGroups.size } },
      })

      const payload = { roundId, mode: 'LIVE' as const, dice: [] as string[], diceSum: 0 }
      notifyAdmin('round:resolved', payload)
      const bettorIds = Array.from(new Set(bets.map(b => b.userId)))
      for (const userId of bettorIds) {
        notifyUser(userId, 'round:resolved', payload)
        const newBalance = refundedBalances[userId]
        if (newBalance != null) {
          notifyUser(userId, 'transaction:updated', {
            id: `round:${roundId}`,
            status: 'COMPLETED',
            type: 'DEPOSIT',
            amount: 0,
            balanceAfter: newBalance,
            note: 'Live round cancelled — stake refunded',
          })
        }
      }

      return { ok: true }
    }

    return { error: translate(locale, 'admin.live.action.unknownOp') }
  } catch (err) {
    console.error('[admin/live]', err)
    return { error: err instanceof Error ? err.message : translate(locale, 'admin.live.action.actionFailed') }
  }
}

export default function AdminLive() {
  const t = useT()
  const { current, currentBets, history: initialHistory, historyHasMore: initialHasMore, lastStreamUrl, liveStreamUrl, schedule, savedBettingSeconds } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live')

  // Round history pagination — first page comes from the loader (100 rows),
  // subsequent pages from /api/admin/live-history via this fetcher. We
  // accumulate into local state so older pages stay visible after the user
  // clicks LOAD MORE; resets whenever the loader returns a fresh first page
  // (e.g. after a round resolves and the loader revalidates).
  const [historyPages, setHistoryPages] = useState(initialHistory)
  const [historyHasMore, setHistoryHasMore] = useState(initialHasMore)
  useEffect(() => {
    setHistoryPages(initialHistory)
    setHistoryHasMore(initialHasMore)
  }, [initialHistory, initialHasMore])
  const loadMoreFetcher = useFetcher<{ history: typeof initialHistory; hasMore: boolean }>()
  useEffect(() => {
    if (loadMoreFetcher.state !== 'idle') return
    const data = loadMoreFetcher.data
    if (!data?.history) return
    setHistoryPages(prev => [...prev, ...data.history])
    setHistoryHasMore(data.hasMore)
  }, [loadMoreFetcher.state, loadMoreFetcher.data])
  function loadMoreHistory() {
    if (historyPages.length === 0) return
    const last = historyPages[historyPages.length - 1]
    loadMoreFetcher.load(`/api/admin/live-history?before=${encodeURIComponent(last.createdAt)}`)
  }
  const loadingMore = loadMoreFetcher.state !== 'idle'

  // Presence: every customer (and admin) viewing the live page joins this
  // channel. We split admins out so the "viewers" count reflects customers only.
  const members = usePresenceMembers(PRESENCE_LIVE)
  const viewers = members.filter(m => m.info.kind === 'user')

  // Each viewer's presence id is `user:<id>`; the snapshot balance in presence
  // info goes stale as they win/lose. Re-query the current REAL balances when
  // the viewer set changes and whenever a round starts/resolves (current?.id).
  const viewerUserIds = viewers.map(v => v.id.replace(/^user:/, ''))
  const viewerIdsKey = viewerUserIds.join(',')
  const balancesFetcher = useFetcher<{ balances: Record<string, number> }>()
  useEffect(() => {
    if (viewerUserIds.length === 0) return
    balancesFetcher.submit(
      { userIds: viewerUserIds },
      { method: 'post', action: '/api/admin/viewer-balances', encType: 'application/json' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIdsKey, current?.id])
  const liveBalances = balancesFetcher.data?.balances ?? {}

  // Live bets feed for the open round. Seeded from the loader, then appended
  // as new bets stream in. Resets whenever the open round changes (new round,
  // round resolved, or initial load with no open round).
  const [bets, setBets] = useState<LiveBet[]>(currentBets)
  useEffect(() => { setBets(currentBets) }, [current?.id])

  // Post-settlement summary, displayed inline above the StartRoundPanel until
  // the admin clicks CLOSE. Cleared whenever a NEW round starts.
  //
  // The resolve fetcher lives HERE (not in ActiveRoundPanel) because that
  // child unmounts as soon as settlement succeeds (loader returns current=null),
  // so a useEffect inside the child would race the unmount and never capture
  // the response. Owning it in the parent (which always stays mounted) is the
  // reliable way to read fetcher.data.
  const [settledSummary, setSettledSummary] = useState<ResolveSummary | null>(null)
  useEffect(() => {
    if (current) setSettledSummary(null)
  }, [current?.id])

  const resolveFetcher = useFetcher<{ ok?: boolean; summary?: ResolveSummary; error?: string }>()
  useEffect(() => {
    if (resolveFetcher.state !== 'idle') return
    const data = resolveFetcher.data
    if (data?.summary) setSettledSummary(data.summary)
  }, [resolveFetcher.state, resolveFetcher.data])

  function settleRound(roundId: string) {
    resolveFetcher.submit({ op: 'resolve', roundId }, { method: 'post' })
  }

  usePusherEvent<BetPlacedPayload>(ADMIN_CHANNEL, 'bet:placed', payload => {
    if (payload.mode !== 'LIVE') return
    if (!current || payload.roundId !== current.id) return
    if (payload.walletType === 'DEMO') return
    setBets(prev => [
      {
        id: `${payload.roundId}:${payload.userId}:${payload.createdAt}:${payload.kind}:${payload.amount}`,
        kind: payload.kind,
        amount: payload.amount,
        symbol: payload.symbol,
        range: payload.range,
        pairA: payload.pairA,
        pairB: payload.pairB,
        createdAt: payload.createdAt,
        userId: payload.userId,
        userTel: payload.userTel,
        userName: payload.userName,
        walletType: payload.walletType,
      },
      ...prev,
    ])
  })

  usePusherEvent<RoundResolvedPayload>(ADMIN_CHANNEL, 'round:resolved', payload => {
    if (payload.mode !== 'LIVE') return
    if (!current || payload.roundId !== current.id) return
    revalidator.revalidate()
  })

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('admin.live.title')}</h1>
        {current && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #fca5a5' }}
          >
            <Radio size={10} className="animate-pulse" /> {t('admin.live.roundInFlightBadge')}
          </span>
        )}
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────── */}
      <div className="flex overflow-hidden rounded-xl" style={{ border: '1px solid #4338ca' }}>
        <button
          type="button"
          onClick={() => setActiveTab('live')}
          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all"
          style={{ background: activeTab === 'live' ? '#4338ca' : '#0f172a', color: activeTab === 'live' ? '#fff' : '#a5b4fc' }}
        >
          <Radio size={12} /> {t('admin.live.tab.livePlay')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all"
          style={{ background: activeTab === 'history' ? '#4338ca' : '#0f172a', color: activeTab === 'history' ? '#fff' : '#a5b4fc' }}
        >
          {t('admin.live.tab.roundHistory')}
          {historyPages.length > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
              style={{ background: activeTab === 'history' ? 'rgba(255,255,255,0.2)' : '#1e1b4b', color: activeTab === 'history' ? '#fff' : '#818cf8' }}
            >
              {historyPages.length}{historyHasMore ? '+' : ''}
            </span>
          )}
        </button>
      </div>

      {/* ─── LIVE PLAY tab ───────────────────────────────────────────── */}
      {activeTab === 'live' && (
        <>
          <LiveStreamPanel
            round={current}
            fallbackUrl={lastStreamUrl}
            liveStreamUrl={liveStreamUrl}
            schedule={schedule}
            loading={loading}
          />

          {current ? (
            <ActiveRoundPanel
              round={current}
              loading={loading}
              onSettle={settleRound}
              settling={resolveFetcher.state !== 'idle'}
              settleError={resolveFetcher.data?.error ?? null}
              viewers={viewers}
              viewerBalances={liveBalances}
              bets={bets}
            />
          ) : (
            <StartRoundPanel defaultStreamUrl={lastStreamUrl} defaultSeconds={savedBettingSeconds} loading={loading} />
          )}

          {/* Settled summary — rendered as a modal so the stream stays visible. */}
          {settledSummary && (
            <div
              className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4"
              style={{ background: 'rgba(15,15,30,0.85)' }}
              onClick={() => setSettledSummary(null)}
            >
              <div className="w-full max-w-2xl my-auto" onClick={e => e.stopPropagation()}>
                <SettledSummaryPanel
                  summary={settledSummary}
                  onClose={() => setSettledSummary(null)}
                  defaultStreamUrl={lastStreamUrl}
                  defaultSeconds={savedBettingSeconds}
                  loading={loading}
                />
              </div>
            </div>
          )}

          {/* Viewers + Live bets — shown inside ResultEntryModal when a round is in flight,
              and here on the main page when no round is active. */}
          {!current && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div className="md:col-span-2">
                <ViewersPanel viewers={viewers} balances={liveBalances} />
              </div>
              <div className="md:col-span-3">
                <LiveBetsPanel bets={bets} hasOpenRound={false} roundId={null} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── ROUND HISTORY tab ───────────────────────────────────────── */}
      {activeTab === 'history' && (
        <section>
          {historyPages.length === 0 ? (
            <div
              className="rounded-xl p-6 text-center text-xs"
              style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
            >
              {t('admin.live.noPreviousRounds')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {historyPages.map(r => (
                <HistoryRow key={r.id} r={r} />
              ))}
              {historyHasMore && (
                <button
                  type="button"
                  onClick={loadMoreHistory}
                  disabled={loadingMore}
                  className="mt-2 inline-flex items-center justify-center gap-1.5 self-center rounded-full px-4 py-1.5 text-[11px] font-bold disabled:opacity-50"
                  style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
                >
                  {loadingMore ? <Loader size={12} className="animate-spin" /> : null}
                  {loadingMore ? t('admin.live.loadingMore') : t('admin.live.loadMore')}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function SettledSummaryPanel({
  summary,
  onClose,
  defaultStreamUrl,
  defaultSeconds,
  loading,
}: {
  summary: ResolveSummary
  onClose: () => void
  defaultStreamUrl: string
  defaultSeconds: number
  loading: boolean
}) {
  const t = useT()
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #4ade80' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold " style={{ color: '#4ade80' }}>
          <Check size={12} /> {t('admin.live.settled.title')} · #{summary.roundId.slice(-6)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-[10px] font-bold "
          style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
        >
          {t('admin.live.settled.close')}
        </button>
      </div>

      <div className="mb-3 flex items-center justify-center gap-2">
        {summary.dice.map((s, i) => (
          <img
            key={i}
            src={`/symbols/${s.toLowerCase()}.png`}
            alt={s}
            className="h-12 w-12 rounded object-contain"
            style={{ border: '1px solid #312e81', background: '#1e1b4b' }}
          />
        ))}
        <span className="ml-2 rounded-md px-3 py-1 text-[11px] font-bold " style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}>
          {t('admin.live.settled.sum', { n: summary.diceSum })}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: t('admin.live.settled.players'), value: summary.totalPlayers.toLocaleString() },
          { label: t('admin.live.settled.totalStake'), value: summary.totalStake.toLocaleString() },
          { label: t('admin.live.settled.totalPayout'), value: summary.totalPayout.toLocaleString() },
          { label: t('admin.live.settled.houseNet'), value: `${summary.houseNet >= 0 ? '+' : ''}${summary.houseNet.toLocaleString()}`, color: summary.houseNet >= 0 ? '#4ade80' : '#f87171' },
        ].map(s => (
          <div key={s.label} className="rounded-md px-2 py-2 text-center" style={{ background: '#1e1b4b' }}>
            <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>{s.label}</div>
            <div className="mt-0.5 text-sm font-bold" style={{ color: s.color ?? '#fde68a' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {summary.players.length === 0 ? (
        <p className="text-center text-[11px]" style={{ color: '#475569' }}>{t('admin.live.settled.noBets')}</p>
      ) : (
        <ul className="mb-4 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {summary.players.map(p => (
            <li
              key={p.userId}
              className="grid grid-cols-3 items-center gap-2 rounded-md px-2 py-1.5 text-xs"
              style={{ background: '#1e1b4b', color: '#e9d5ff' }}
            >
              <span className="truncate">{p.userName ? `${p.userName} · ` : ''}{p.userTel}</span>
              <span className="text-right font-bold" style={{ color: p.net > 0 ? '#4ade80' : p.net < 0 ? '#f87171' : '#fde68a' }}>
                {p.net > 0 ? '+' : ''}{p.net.toLocaleString()}
              </span>
              <span className="text-right text-[10px]" style={{ color: '#a5b4fc' }}>
                {t('admin.live.settled.bal', { n: p.newBalance.toLocaleString() })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Start next round ── */}
      <div className="mt-2 rounded-lg p-3" style={{ background: '#0a1a0f', border: '1px solid #166534' }}>
        <div className="mb-3 flex items-center gap-2 text-[10px] font-bold" style={{ color: '#4ade80' }}>
          <Radio size={11} /> {t('admin.live.startNextRound')}
        </div>
        <Form method="post" className="flex flex-col gap-2" onSubmit={onClose}>
          <input type="hidden" name="op" value="startRound" />

          <label className="text-[10px] font-semibold" style={{ color: '#86efac' }}>{t('admin.live.streamUrlLabel')}</label>
          <input
            name="streamUrl"
            defaultValue={defaultStreamUrl}
            placeholder="YouTube, MP4, HLS, …"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
          />

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-[10px] font-semibold" style={{ color: '#86efac' }}>{t('admin.live.bettingWindowLabel')}</label>
              <input
                name="seconds"
                type="number"
                min={15}
                max={600}
                defaultValue={defaultSeconds}
                className="rounded-lg px-3 py-2 text-xs outline-none"
                style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: '1.5px solid #4ade80' }}
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <PlayCircle size={14} />}
            {t('admin.live.startNextRound')}
          </button>
        </Form>
      </div>
    </div>
  )
}

function ViewersPanel({ viewers, balances = {} }: { viewers: ReturnType<typeof usePresenceMembers>; balances?: Record<string, number> }) {
  const t = useT()
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold " style={{ color: '#a5b4fc' }}>
          <UsersIcon size={12} /> VIEWERS
        </span>
        <span className="text-[10px] font-bold" style={{ color: '#fde68a' }}>{viewers.length}</span>
      </div>
      {viewers.length === 0 ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>{t('admin.live.noViewers')}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {viewers.map(v => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
              style={{ background: '#1e1b4b' }}
            >
              <span className="truncate" style={{ color: '#e9d5ff' }}>
                {v.info.kind === 'admin' ? (v.info.name ?? 'Admin') : (v.info.tel ?? v.id)}
              </span>
              <span className="text-[10px] font-bold" style={{ color: '#fde68a' }}>
                {v.info.kind === 'user'
                  ? `${(balances[v.id.replace(/^user:/, '')] ?? v.info.balance ?? 0).toLocaleString()} ₭`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Groups bets placed on the exact same selection (e.g. every FISH bet, every
// FROG+ROOSTER pair regardless of which symbol the bettor tapped first) into
// one row so admins watching a crowded round aren't scanning dozens of
// near-duplicate lines. Database rows stay untouched — this is display-only.
function liveBetGroupKey(b: LiveBet): string {
  switch (b.kind) {
    case 'SYMBOL': return `SYMBOL:${b.symbol}`
    case 'RANGE': return `RANGE:${b.range}`
    case 'SUM': return `SUM:${b.exactSum}`
    case 'PAIR': return `PAIR:${[b.pairA, b.pairB].sort().join('+')}`
    default: return `${b.kind}:${b.symbol}:${b.range}:${b.pairA}:${b.pairB}:${b.exactSum}`
  }
}

type GroupedLiveBet = Pick<LiveBet, 'kind' | 'symbol' | 'range' | 'pairA' | 'pairB' | 'exactSum'> & {
  key: string
  amount: number
  bettors: { tel: string; name: string | null }[]
}

function groupLiveBets(bets: LiveBet[]): GroupedLiveBet[] {
  const groups = new Map<string, GroupedLiveBet>()
  for (const b of bets) {
    const key = liveBetGroupKey(b)
    let g = groups.get(key)
    if (!g) {
      g = { key, kind: b.kind, symbol: b.symbol, range: b.range, pairA: b.pairA, pairB: b.pairB, exactSum: b.exactSum, amount: 0, bettors: [] }
      groups.set(key, g)
    }
    g.amount += b.amount
    if (!g.bettors.some(p => p.tel === b.userTel)) g.bettors.push({ tel: b.userTel, name: b.userName })
  }
  return Array.from(groups.values()).sort((a, b) => b.amount - a.amount)
}

function LiveBetsPanel({
  bets,
  hasOpenRound,
  roundId,
  maxHeight = '500px',
}: {
  bets: LiveBet[]
  hasOpenRound: boolean
  roundId: string | null
  maxHeight?: string
}) {
  const t = useT()
  const totalStake = bets.reduce((sum, b) => sum + b.amount, 0)
  const grouped = useMemo(() => groupLiveBets(bets), [bets])
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold " style={{ color: '#a5b4fc' }}>
          <Radio size={12} /> LIVE BETS{roundId && <span className="text-[9px] font-mono" style={{ color: '#475569' }}>#{roundId.slice(-6)}</span>}
        </span>
        <span className="text-[10px]" style={{ color: '#fde68a' }}>
          {t('admin.live.betsStake', { n: bets.length, stake: totalStake.toLocaleString() })}
        </span>
      </div>
      {!hasOpenRound ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>{t('admin.live.startLiveRoundHint')}</p>
      ) : grouped.length === 0 ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>{t('admin.live.noBetsThisRound')}</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight }}>
          {grouped.map(g => (
            <li
              key={g.key}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
              style={{ background: '#1e1b4b' }}
            >
              <div className="min-w-0">
                <div className="truncate font-semibold" style={{ color: '#e9d5ff' }}>
                  {/* Single bettor → name (fall back to tel). Multiple bettors
                      on the same selection → every phone number, comma-joined. */}
                  {g.bettors.length === 1
                    ? (g.bettors[0].name ?? g.bettors[0].tel)
                    : g.bettors.map(p => p.tel).join(', ')}
                </div>
                <div className="mt-0.5" style={{ color: '#a5b4fc' }}>
                  <LiveBetDescription bet={g} />
                </div>
              </div>
              <span className="shrink-0 font-bold" style={{ color: '#fde68a' }}>{g.amount.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// JSX renderer for the description line under each LIVE BETS row.
//   - SYMBOL / PAIR → small symbol thumbnail(s) + uppercase name
//   - RANGE → colored arrow icon (low=green↓, middle=yellow↕, high=red↑)
function LiveBetDescription({ bet }: { bet: Pick<LiveBet, 'kind' | 'symbol' | 'range' | 'pairA' | 'pairB' | 'exactSum'> }) {
  const t = useT()
  if (bet.kind === 'SYMBOL' && bet.symbol) {
    return (
      <span className="flex items-center gap-1.5 text-[10px]">
        <img
          src={`/symbols/${bet.symbol.toLowerCase()}.png`}
          alt=""
          className="h-4 w-4 shrink-0 rounded object-contain"
          style={{ background: '#fff' }}
        />
        <span>{bet.symbol}</span>
      </span>
    )
  }
  if (bet.kind === 'PAIR' && bet.pairA && bet.pairB) {
    return (
      <span className="flex items-center gap-1 text-[10px]">
        <img src={`/symbols/${bet.pairA.toLowerCase()}.png`} alt="" className="h-4 w-4 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
        <span>{bet.pairA}</span>
        <span>+</span>
        <img src={`/symbols/${bet.pairB.toLowerCase()}.png`} alt="" className="h-4 w-4 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
        <span>{bet.pairB}</span>
      </span>
    )
  }
  if (bet.kind === 'RANGE' && bet.range) {
    const Icon = bet.range === 'LOW' ? ArrowDown : bet.range === 'HIGH' ? ArrowUp : ArrowUpDown
    const color = bet.range === 'LOW' ? '#4ade80' : bet.range === 'HIGH' ? '#f87171' : '#fbbf24'
    const bounds = bet.range === 'LOW' ? '3-8' : bet.range === 'HIGH' ? '11-18' : '9-10'
    return (
      <span className="flex items-center gap-1.5 text-[10px]">
        <Icon size={14} style={{ color }} className="shrink-0" />
        <span>{bet.range} ({bounds})</span>
      </span>
    )
  }
  if (bet.kind === 'SUM' && bet.exactSum != null) {
    return <span className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>{t('admin.live.sumExact', { n: bet.exactSum })}</span>
  }
  return <span className="text-[10px]">{bet.kind}</span>
}

// ─────────────────────────────────────────────────────────────────────────────

type CurrentRound = NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['current']>
type HistoryRound = ReturnType<typeof useLoaderData<typeof loader>>['history'][number]

function ActiveRoundPanel({
  round,
  loading,
  onSettle,
  settling,
  settleError,
  viewers,
  viewerBalances,
  bets,
}: {
  round: CurrentRound
  loading: boolean
  onSettle: (roundId: string) => void
  settling: boolean
  settleError: string | null
  viewers: ReturnType<typeof usePresenceMembers>
  viewerBalances: Record<string, number>
  bets: LiveBet[]
}) {
  const t = useT()
  // Server is the source of truth for which dice are "live" — admin clicks
  // PATCH the GameRound and re-broadcast on round:dice. We mirror the server
  // values into local state for snappy UI on click; a Pusher event from a
  // sibling tab updates this same state.
  const [dice, setDice] = useState<(DiceSymbol | null)[]>([
    (round.dice1 as DiceSymbol | null) ?? null,
    (round.dice2 as DiceSymbol | null) ?? null,
    (round.dice3 as DiceSymbol | null) ?? null,
  ])
  useEffect(() => {
    setDice([
      (round.dice1 as DiceSymbol | null) ?? null,
      (round.dice2 as DiceSymbol | null) ?? null,
      (round.dice3 as DiceSymbol | null) ?? null,
    ])
  }, [round.id])

  // Listen on private-admin so multi-tab admins (and our own optimistic
  // update from a sibling tab) stay in sync without a hard refresh.
  usePusherEvent<RoundDicePayload>(ADMIN_CHANNEL, 'round:dice', payload => {
    if (payload.roundId !== round.id) return
    setDice(prev => {
      const next = [...prev]
      const i = payload.dieIndex - 1
      if (i >= 0 && i < 3) next[i] = payload.symbol as DiceSymbol
      return next
    })
  })

  const allPicked = dice.every((d): d is DiceSymbol => d != null)
  const liveSum = allPicked ? SYMBOL_VALUE[dice[0]] + SYMBOL_VALUE[dice[1]] + SYMBOL_VALUE[dice[2]] : null

  // Live countdown ticking each second from the server's bettingClosesAt.
  const closesAtMs = round.bettingClosesAt ? new Date(round.bettingClosesAt).getTime() : null
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const remainingSeconds = closesAtMs ? Math.max(0, Math.ceil((closesAtMs - nowMs) / 1000)) : null
  const bettingExpired = remainingSeconds != null && remainingSeconds === 0

  // Per-die fetcher — each click submits the revealDie op and gets re-used
  // (we don't need the response; the round:dice event mirrors back).
  const dieFetcher = useFetcher<{ ok?: boolean; error?: string }>()
  function pickDie(index: 1 | 2 | 3, symbol: DiceSymbol) {
    // Optimistic local update; the round:dice broadcast re-confirms it.
    setDice(prev => {
      const next = [...prev]
      next[index - 1] = symbol
      return next
    })
    dieFetcher.submit(
      { op: 'revealDie', roundId: round.id, dieIndex: String(index), symbol },
      { method: 'post' },
    )
  }

  // Settlement is owned by the parent (so the response survives this panel
  // unmounting on success). We just trigger it and reflect the inflight flag.
  function settle() {
    if (!allPicked) return
    onSettle(round.id)
  }
  const submitting = settling

  // Result-entry modal: open immediately when a round is active so the admin
  // can watch bets stream in. Admin can close it and re-open via the button.
  const [resultModalOpen, setResultModalOpen] = useState(true)

  return (
    <div className="flex flex-col gap-4">
      {/* Compact result-control bar — opens the result-entry modal */}
      <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold " style={{ color: '#a5b4fc' }}>{t('admin.live.roundResult')}</span>
          <span className="text-[10px]" style={{ color: '#818cf8' }}>{t('admin.live.betsShort', { n: round.bets })} · #{round.id.slice(-6)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {round.status === 'BETTING' && (
            <Form method="post" className="inline">
              <input type="hidden" name="op" value="lock" />
              <input type="hidden" name="roundId" value={round.id} />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold  disabled:opacity-50"
                style={{ background: '#1e1b4b', color: '#fdba74', border: '1px solid #fb923c' }}
              >
                {loading ? <Loader size={10} className="animate-spin" /> : <Lock size={10} />}
                {t('admin.live.lockBetting')}
              </button>
            </Form>
          )}
          <button
            type="button"
            onClick={() => setResultModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold "
            style={{ background: '#4338ca', color: '#fff', border: '1px solid #818cf8' }}
          >
            {t('admin.live.openResultBoard')}
          </button>
          {allPicked && (
            <span className="text-[10px]" style={{ color: '#a5b4fc' }}>
              {t('admin.live.sumInline')} <span className="font-bold" style={{ color: '#fde68a' }}>{liveSum}</span>
            </span>
          )}
          <Form method="post" className="ml-auto inline">
            <input type="hidden" name="op" value="cancel" />
            <input type="hidden" name="roundId" value={round.id} />
            <button
              type="submit"
              disabled={loading || submitting}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold  disabled:opacity-50"
              style={{ background: '#7f1d1d', color: '#fff', border: '1px solid #fca5a5' }}
            >
              {loading ? <Loader size={10} className="animate-spin" /> : <X size={10} />}
              {t('admin.live.cancel')}
            </button>
          </Form>
        </div>
      </div>

      {resultModalOpen && (
        <ResultEntryModal
          round={round}
          dice={dice}
          pickDie={pickDie}
          allPicked={allPicked}
          liveSum={liveSum}
          settleError={settleError}
          onSettle={settle}
          submitting={submitting}
          bettingExpired={bettingExpired}
          remainingSeconds={remainingSeconds}
          onClose={() => setResultModalOpen(false)}
          viewers={viewers}
          viewerBalances={viewerBalances}
          bets={bets}
        />
      )}
    </div>
  )
}

function ResultEntryModal({
  round,
  dice,
  pickDie,
  allPicked,
  liveSum,
  settleError,
  onSettle,
  submitting,
  bettingExpired,
  remainingSeconds,
  onClose,
  viewers,
  viewerBalances,
  bets,
}: {
  round: CurrentRound
  dice: (DiceSymbol | null)[]
  pickDie: (index: 1 | 2 | 3, symbol: DiceSymbol) => void
  allPicked: boolean
  liveSum: number | null
  settleError: string | null
  onSettle: () => void
  submitting: boolean
  bettingExpired: boolean
  remainingSeconds: number | null
  onClose: () => void
  viewers: ReturnType<typeof usePresenceMembers>
  viewerBalances: Record<string, number>
  bets: LiveBet[]
}) {
  const t = useT()
  const { payoutCfg, livePromo } = useLoaderData<typeof loader>()
  const stillBetting = round.status === 'BETTING' && !bettingExpired
  // Score every 3-distinct-dice result by its payout against the current bets —
  // recomputed whenever a new bet streams in. `lowPicks` = cheapest 3 (safe),
  // `highPicks` = priciest 3 (avoid), `topSymbol` = most-exposed single die.
  const { lowPicks, highPicks, topSymbol, zeroSymbols } = useMemo(() => {
    const ranked = rankCombosByPayout(bets, payoutCfg, livePromo)
    const exposure = symbolExposure(bets)
    let topSymbol: { symbol: DiceSymbol; total: number } | null = null
    const zeroSymbols: DiceSymbol[] = []
    for (const s of SYMBOLS) {
      const total = exposure.get(s) ?? 0
      if (total === 0) zeroSymbols.push(s)
      else if (!topSymbol || total > topSymbol.total) topSymbol = { symbol: s, total }
    }
    return {
      lowPicks: ranked.slice(0, 3),
      highPicks: ranked.slice(-3).reverse(), // most-expensive first
      topSymbol,
      zeroSymbols,
    }
  }, [bets, payoutCfg, livePromo])
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="my-auto w-full max-w-2xl rounded-xl p-4"
        style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold " style={{ color: '#a5b4fc' }}>
            {t('admin.live.roundResultHash', { id: round.id.slice(-6) })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1"
            style={{ color: '#a5b4fc', background: '#1e1b4b' }}
            aria-label={t('admin.live.settled.close')}
          >
            <X size={16} />
          </button>
        </div>

        {stillBetting ? (
          <div className="mb-3 rounded-xl px-4 py-2.5 text-center text-xs" style={{ background: '#1e1b4b' }}>
            <span style={{ color: '#cbd5e1' }}>{t('admin.live.bettingWindowOpen')}</span>
            {remainingSeconds != null && (
              <span style={{ color: '#fde68a' }}>{t('admin.live.remainingSeconds', { n: remainingSeconds })}</span>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {[1, 2, 3].map(idx => (
                <DiceSlot
                  key={idx}
                  label={t('admin.live.diceLabel', { n: idx })}
                  value={dice[idx - 1] ?? ''}
                  onChange={s => pickDie(idx as 1 | 2 | 3, s)}
                />
              ))}
            </div>

            {allPicked && (
              <div className="mt-3 text-center text-xs" style={{ color: '#a5b4fc' }}>
                {t('admin.live.sumInline')} <span className="font-bold" style={{ color: '#fde68a' }}>{liveSum}</span>
              </div>
            )}

            {settleError && (
              <div className="mt-3 rounded-md px-3 py-2 text-center text-[11px]" style={{ background: 'rgba(220,38,38,0.2)', color: '#fca5a5', border: '1px solid #fca5a5' }}>
                {settleError}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSettle}
                disabled={!allPicked || submitting}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold  disabled:opacity-30"
                style={{ background: '#14532d', color: '#fff', border: '1px solid #4ade80' }}
                title={allPicked ? t('admin.live.settleTitleReady') : t('admin.live.settleTitleNotReady')}
              >
                {submitting ? <Loader size={10} className="animate-spin" /> : <Check size={10} />}
                {t('admin.live.summaryBtn')}
              </button>

              {/* Low-payout suggestions: 3 distinct-dice results, cheapest first. */}
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                {t('admin.live.lowPayoutPicks')}
              </span>
              {lowPicks.map((s, i) => (
                <div
                  key={s.dice.join('-')}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ background: '#1e1b4b', border: `1px solid ${s.payout === 0 ? '#16a34a' : '#4338ca'}` }}
                  title={t('admin.live.lowPayoutHint', { rank: i + 1, sum: s.diceSum, payout: s.payout.toLocaleString() })}
                >
                  <div className="flex gap-0.5">
                    {s.dice.map((d, di) => (
                      <img key={di} src={symbolSrc(d)} alt={d} className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: s.payout === 0 ? '#4ade80' : '#fde68a' }}>
                    {s.payout.toLocaleString()}
                  </span>
                </div>
              ))}

              {/* Single dice with zero bets — totally safe to show. */}
              {zeroSymbols.length > 0 && (
                <div
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ background: '#1e1b4b', border: '1px solid #16a34a' }}
                  title={t('admin.live.zeroBetDieHint')}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: '#4ade80' }}>
                    {t('admin.live.zeroBetDie')}
                  </span>
                  <div className="flex gap-0.5">
                    {zeroSymbols.map(s => (
                      <img key={s} src={symbolSrc(s)} alt={s} className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <ViewersPanel viewers={viewers} balances={viewerBalances} />
          </div>
          <div className="md:col-span-3">
            <LiveBetsPanel bets={bets} hasOpenRound={true} roundId={round.id} maxHeight="240px" />
          </div>
        </div>

        {/* Bottom danger row: highest-payout results (avoid) on the left,
            single most-bet die (most exposed) on the right. */}
        {bets.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                {t('admin.live.highPayoutPicks')}
              </span>
              {highPicks.map((s, i) => (
                <div
                  key={s.dice.join('-')}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ background: '#1e1b4b', border: '1px solid #7f1d1d' }}
                  title={t('admin.live.highPayoutHint', { rank: i + 1, sum: s.diceSum, payout: s.payout.toLocaleString() })}
                >
                  <div className="flex gap-0.5">
                    {s.dice.map((d, di) => (
                      <img key={di} src={symbolSrc(d)} alt={d} className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: '#f87171' }}>
                    {s.payout.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {topSymbol && (
              <div className="inline-flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
                  {t('admin.live.mostBetDie')}
                </span>
                <div
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ background: '#1e1b4b', border: '1px solid #b45309' }}
                  title={t('admin.live.mostBetDieHint', { total: topSymbol.total.toLocaleString() })}
                >
                  <img src={symbolSrc(topSymbol.symbol)} alt={topSymbol.symbol} className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: '#fbbf24' }}>
                    {topSymbol.total.toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Shape the resolve action returns when settlement succeeds. Drives the
// post-settle summary panel.
type ResolveSummary = {
  roundId: string
  dice: string[]
  diceSum: number
  totalBets: number
  totalPlayers: number
  totalStake: number
  totalPayout: number
  houseNet: number
  players: {
    userId: string
    userTel: string
    userName: string | null
    stake: number
    payout: number
    net: number
    newBalance: number
  }[]
}

// Always-visible stream area. Shows the active round's stream + URL update
// form when a round is open; falls back to the last known stream URL when
// no round is active so the admin keeps watching the camera between rounds.
// When no round is active, the header shows End Live + Schedule buttons.
function LiveStreamPanel({
  round,
  fallbackUrl,
  liveStreamUrl,
  schedule,
  loading,
}: {
  round: CurrentRound | null
  fallbackUrl: string
  liveStreamUrl: string | null
  schedule: { start: string | null; end: string | null; notice: string | null }
  loading: boolean
}) {
  const t = useT()
  const [showScheduleModal, setShowScheduleModal] = useState(false)

  // Live countdown for the active round's betting window.
  const closesAtMs = round?.bettingClosesAt ? new Date(round.bettingClosesAt).getTime() : null
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!closesAtMs) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [closesAtMs])
  const remainingSeconds = closesAtMs ? Math.max(0, Math.ceil((closesAtMs - nowMs) / 1000)) : null
  const bettingExpired = remainingSeconds != null && remainingSeconds === 0

  // Use liveStreamUrl (SystemSetting) as the between-rounds fallback, not the
  // last DB round. After "End Live" liveStreamUrl is null, so both admin and
  // customers see the schedule/offline card instead of a stale stream.
  const url = round?.streamUrl ?? liveStreamUrl ?? null
  const hasSchedule = !!schedule.start

  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold shrink-0" style={{ color: '#a5b4fc' }}>{t('admin.live.liveStreamTitle')}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {round && remainingSeconds != null && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                background: bettingExpired ? 'rgba(234,88,12,0.2)' : remainingSeconds <= 10 ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)',
                color: bettingExpired ? '#fdba74' : remainingSeconds <= 10 ? '#fca5a5' : '#4ade80',
                border: `1px solid ${bettingExpired ? '#fb923c' : remainingSeconds <= 10 ? '#fca5a5' : '#4ade80'}`,
              }}
            >
              {bettingExpired ? t('admin.live.bettingClosed') : `⏱ ${remainingSeconds}s`}
            </span>
          )}
          {round && <StatusPill status={round.status} />}

          {/* When no active round: End Live + Schedule buttons */}
          {!round && (
            <>
              {/* End Live — always visible; disabled when no stream is active */}
              <Form method="post" className="inline">
                <input type="hidden" name="op" value="endLive" />
                <button
                  type="submit"
                  disabled={loading || !liveStreamUrl}
                  title={liveStreamUrl ? t('admin.live.endLiveTitleActive') : t('admin.live.endLiveTitleInactive')}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-[10px] font-bold transition-opacity disabled:opacity-30"
                  style={{ background: 'linear-gradient(135deg,#7f1d1d,#450a0a)', color: '#fca5a5', border: '1px solid #ef4444' }}
                >
                  {loading ? <Loader size={10} className="animate-spin" /> : <Square size={10} />}
                  {t('admin.live.endLive')}
                </button>
              </Form>
              <button
                type="button"
                onClick={() => setShowScheduleModal(true)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-[10px] font-bold"
                style={{
                  background: hasSchedule ? 'rgba(67,56,202,0.4)' : '#1e1b4b',
                  color: hasSchedule ? '#a5b4fc' : '#818cf8',
                  border: `1px solid ${hasSchedule ? '#4338ca' : '#312e81'}`,
                }}
              >
                <CalendarClock size={10} />
                {hasSchedule ? t('admin.live.scheduleSet') : t('admin.live.schedule')}
              </button>
              {!liveStreamUrl && (
                <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(76,29,149,0.4)', color: '#c4b5fd', border: '1px solid #6d28d9' }}>
                  {t('admin.live.noActiveRound')}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {url ? <StreamEmbed url={url} /> : <AdminOfflineCard schedule={schedule} />}

      {round && (
        <Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="op" value="updateStream" />
          <input type="hidden" name="roundId" value={round.id} />
          <input
            name="streamUrl"
            defaultValue={round.streamUrl ?? ''}
            placeholder={t('admin.live.streamUrlPlaceholder')}
            className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md px-3 py-1.5 text-[10px] font-bold disabled:opacity-50"
            style={{ background: '#4338ca', color: '#fff', border: '1px solid #818cf8' }}
          >
            {t('admin.live.updateStream')}
          </button>
        </Form>
      )}

      {/* Schedule modal */}
      {showScheduleModal && (
        <ScheduleModal
          schedule={schedule}
          loading={loading}
          onClose={() => setShowScheduleModal(false)}
        />
      )}
    </div>
  )
}

// Shown in the stream area when END LIVE has been clicked (liveStreamUrl = null).
// Mirrors what customers see: schedule + countdown, or an offline placeholder.
function AdminOfflineCard({ schedule }: { schedule: { start: string | null; end: string | null; notice: string | null } }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!schedule.start) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg"
        style={{ background: '#0a0014', border: '1px dashed #4338ca' }}>
        <span style={{ fontSize: 40 }}>📴</span>
        <p className="text-xs font-semibold" style={{ color: '#6d28d9' }}>{t('admin.live.liveEndedNoSchedule')}</p>
        <p className="text-[10px]" style={{ color: '#475569' }}>{t('admin.live.offlineHint')}</p>
      </div>
    )
  }

  const startMs = new Date(schedule.start).getTime()
  const endMs   = schedule.end ? new Date(schedule.end).getTime() : null
  const diffMs  = startMs - now

  const totalSec = Math.max(0, Math.floor(diffMs / 1000))
  const days  = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins  = Math.floor((totalSec % 3600) / 60)
  const secs  = totalSec % 60
  const units = [{ l: t('admin.live.unit.days'), v: days }, { l: t('admin.live.unit.hours'), v: hours }, { l: t('admin.live.unit.mins'), v: mins }, { l: t('admin.live.unit.secs'), v: secs }]

  const isPast    = endMs !== null && now > endMs
  const isLive    = diffMs <= 0 && !isPast

  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-lg"
      style={{ background: '#0a0014', border: '1px dashed #4338ca' }}>
      <span style={{ fontSize: 36 }}>{isPast ? '📴' : isLive ? '🔴' : '📅'}</span>
      <div className="text-center">
        <p className="text-xs font-bold" style={{ color: '#fde68a' }}>
          {isPast ? t('admin.live.broadcastEnded') : isLive ? t('admin.live.broadcastWindow') : t('admin.live.nextBroadcast')}
        </p>
        <p className="mt-0.5 text-[10px]" style={{ color: '#818cf8' }}>
          {fmtGMT7(schedule.start!)}{schedule.end ? ` — ${fmtGMT7(schedule.end, { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''} (GMT+7)
        </p>
        {schedule.notice && (
          <p className="mt-1 text-[10px] italic" style={{ color: '#c4b5fd' }}>{schedule.notice}</p>
        )}
      </div>
      {!isPast && !isLive && (
        <div className="flex gap-3">
          {units.map(({ l, v }) => (
            <div key={l} className="flex flex-col items-center">
              <span className="rounded-lg px-3 py-1.5 text-lg font-bold tabular-nums"
                style={{ background: 'rgba(76,29,149,0.5)', color: '#fde68a', minWidth: 48, textAlign: 'center' }}>
                {String(v).padStart(2, '0')}
              </span>
              <span className="mt-0.5 text-[9px]" style={{ color: '#818cf8' }}>{l}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px]" style={{ color: '#475569' }}>{t('admin.live.countdownHint')}</p>
    </div>
  )
}

function ScheduleModal({
  schedule,
  loading,
  onClose,
}: {
  schedule: { start: string | null; end: string | null; notice: string | null }
  loading: boolean
  onClose: () => void
}) {
  const t = useT()
  const hasSchedule = !!schedule.start
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: '#0f172a', border: '1px solid #4338ca' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: '#a5b4fc' }}>
            <CalendarClock size={14} /> {t('admin.live.nextLiveSchedule')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1"
            style={{ color: '#a5b4fc', background: '#1e1b4b' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Current schedule */}
        {hasSchedule && (
          <div className="mb-4 rounded-lg px-3 py-2.5" style={{ background: '#1e1b4b', border: '1px solid #312e81' }}>
            <div className="text-[10px] font-bold mb-1" style={{ color: '#818cf8' }}>{t('admin.live.current')}</div>
            <div className="text-xs font-semibold" style={{ color: '#fde68a' }}>
              {fmtGMT7(schedule.start!)} — {schedule.end ? fmtGMT7(schedule.end, { hour: '2-digit', minute: '2-digit', hour12: false }) : '?'}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: '#818cf8' }}>{t('admin.live.gmt7Laos')}</div>
          </div>
        )}

        {/* Set schedule form */}
        <Form method="post" className="flex flex-col gap-3" onSubmit={onClose}>
          <input type="hidden" name="op" value="setSchedule" />

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold" style={{ color: '#a5b4fc' }}>{t('admin.live.dateLabel')}</label>
            <input
              name="scheduleDate"
              type="date"
              defaultValue={schedule.start ? isoToGMT7DateInput(schedule.start) : ''}
              required
              className="rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold" style={{ color: '#a5b4fc' }}>{t('admin.live.startLabel')}</label>
              <input
                name="scheduleStart"
                type="time"
                defaultValue={schedule.start ? isoToGMT7TimeInput(schedule.start) : ''}
                required
                className="rounded-lg px-3 py-2 text-xs outline-none"
                style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold" style={{ color: '#a5b4fc' }}>{t('admin.live.endLabel')}</label>
              <input
                name="scheduleEnd"
                type="time"
                defaultValue={schedule.end ? isoToGMT7TimeInput(schedule.end) : ''}
                required
                className="rounded-lg px-3 py-2 text-xs outline-none"
                style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold" style={{ color: '#a5b4fc' }}>{t('admin.live.noticeLabel')}</label>
            <textarea
              name="scheduleNotice"
              defaultValue={schedule.notice ?? ''}
              placeholder={t('admin.live.noticePlaceholder')}
              rows={2}
              className="rounded-lg px-3 py-2 text-xs outline-none resize-none"
              style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
            />
          </div>

          <div className="flex gap-2">
            {hasSchedule && (
              <Form method="post" onSubmit={onClose} className="flex flex-1">
                <input type="hidden" name="op" value="clearSchedule" />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-50"
                  style={{ background: 'rgba(127,29,29,0.4)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
                >
                  {t('admin.live.clear')}
                </button>
              </Form>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#4338ca,#312e81)', color: '#fff', border: '1px solid #818cf8' }}
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              {t('admin.live.save')}
            </button>
          </div>
        </Form>
      </div>
    </div>
  )
}

function StartRoundPanel({ defaultStreamUrl, defaultSeconds, loading }: { defaultStreamUrl: string; defaultSeconds: number; loading: boolean }) {
  const t = useT()
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold " style={{ color: '#a5b4fc' }}>
        <Radio size={12} /> {t('admin.live.startNewLiveRound')}
      </div>
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="op" value="startRound" />

        <label className="text-[10px] font-semibold " style={{ color: '#a5b4fc' }}>{t('admin.live.streamUrlLabel')}</label>
        <input
          name="streamUrl"
          defaultValue={defaultStreamUrl}
          placeholder="YouTube, MP4, HLS, …"
          className="rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
        />

        <label className="text-[10px] font-semibold " style={{ color: '#a5b4fc' }}>{t('admin.live.bettingWindowLabel')}</label>
        <input
          name="seconds"
          type="number"
          min={15}
          max={600}
          defaultValue={defaultSeconds}
          className="rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold  disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: '1.5px solid #4ade80' }}
        >
          {loading ? <Loader size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          {t('admin.live.startRound')}
        </button>
      </Form>
    </div>
  )
}

function DiceSlot({
  label,
  value,
  onChange,
}: {
  label: string
  value: DiceSymbol | ''
  onChange: (v: DiceSymbol) => void
}) {
  const t = useT()
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-2"
      style={{ background: '#1e1b4b', border: '1px solid #312e81' }}
    >
      <div className="text-center text-[10px] font-bold " style={{ color: '#a5b4fc' }}>{label}</div>
      {/* Mobile: 6 symbols in a single row. md+: 2 rows of 3 (preserves prior compact look). */}
      <div className="grid grid-cols-6 gap-1 md:grid-cols-3">
        {SYMBOLS.map(s => {
          const selected = value === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className="flex flex-col items-center justify-center rounded-md p-1 transition-colors"
              style={{
                background: selected ? '#4338ca' : '#0f172a',
                border: `1px solid ${selected ? '#fde68a' : '#312e81'}`,
              }}
              title={s}
            >
              <img
                src={symbolSrc(s)}
                alt={s}
                className="aspect-square w-full max-w-[44px] rounded object-contain"
              />
              <span className="mt-0.5 text-[9px] font-bold " style={{ color: selected ? '#fde68a' : '#818cf8' }}>
                {SYMBOL_VALUE[s]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HlsVideo({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<{ destroy(): void } | null>(null)
  const isHls = /\.m3u8(\?|$)/i.test(src)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    hlsRef.current?.destroy()
    hlsRef.current = null
    if (!isHls) { video.src = src; return }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.play().catch(() => {})
      return
    }
    import('hls.js').then(({ default: Hls }) => {
      if (!videoRef.current) return
      if (!Hls.isSupported()) { videoRef.current.src = src; return }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(videoRef.current)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {})
      })
    })
    return () => { hlsRef.current?.destroy(); hlsRef.current = null }
  }, [src, isHls])
  return <video ref={videoRef} controls autoPlay muted playsInline className={className} />
}

function StreamEmbed({ url }: { url: string | null }) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  // Facebook's video plugin renders at a fixed pixel width — we measure the
  // container once after mount and pass it as the `width` URL param so the
  // plugin fills the iframe exactly. Stays null until measured so we don't
  // render the iframe with the wrong size first.
  const [fbWidth, setFbWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!containerRef.current) return
    const w = containerRef.current.offsetWidth
    setFbWidth(w >= 220 ? Math.min(1560, w) : 560)
  }, [url])

  if (!url) {
    return (
      <div
        ref={containerRef}
        className="flex aspect-video items-center justify-center rounded-lg text-xs"
        style={{ background: '#1e1b4b', color: '#818cf8', border: '1px dashed #4338ca' }}
      >
        {t('admin.live.noStreamUrl')}
      </div>
    )
  }
  const isCf = /cloudflarestream\.com/i.test(url)
  const isVideoFile = /\.(mp4|webm|mov)(\?|$)/i.test(url)
  const isHls = /\.m3u8(\?|$)/i.test(url)
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)
  const isFb = /(?:facebook\.com|fb\.watch)/i.test(url)
  const embedUrl = yt
    ? `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1&playsinline=1`
    : isFb && fbWidth !== null
      ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true&mute=1&width=${fbWidth}`
      : url

  const containerStyle: React.CSSProperties = isFb
    ? { height: '50vh', aspectRatio: '9/16', border: '1px solid #4338ca' }
    : { border: '1px solid #4338ca' }

  // Cloudflare Stream iframe src (admin keeps controls=true)
  function cfSrc(raw: string) {
    const m = raw.match(/(https:\/\/customer-[^.]+\.cloudflarestream\.com\/[a-f0-9]+)/i)
    if (!m) return raw
    return `${m[1]}/iframe?autoplay=true&muted=true`
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg bg-black${isFb ? ' mx-auto' : ''}`}
      style={containerStyle}
    >
      {isCf ? (
        <iframe
          src={cfSrc(url)}
          title={t('admin.live.liveStreamTitle')}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full bg-black"
          style={{ display: 'block', border: 'none' }}
        />
      ) : isVideoFile || isHls ? (
        <HlsVideo src={url} className="aspect-video w-full bg-black" />
      ) : isFb && fbWidth === null ? (
        <div className="h-full w-full bg-black" />
      ) : (
        <iframe
          src={embedUrl}
          title={t('admin.live.liveStreamTitle')}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className={`${isFb ? 'h-full w-full' : 'aspect-video w-full'} bg-black`}
          style={{ display: 'block', border: 'none' }}
        />
      )}
    </div>
  )
}

function HistoryRow({ r }: { r: HistoryRound }) {
  const t = useT()
  const dice = [r.dice1, r.dice2, r.dice3].filter(Boolean) as DiceSymbol[]
  return (
    <div
      className="flex flex-col gap-1 rounded-xl px-4 py-3 md:flex-row md:items-center md:justify-between"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={r.status} />
          <span className="text-xs" style={{ color: '#818cf8' }}>{new Date(r.bettingOpensAt).toLocaleString()}</span>
          <span className="text-xs" style={{ color: '#a5b4fc' }}>· {t('admin.live.betsShort', { n: r.bets })}</span>
          <span className="text-[10px]" style={{ color: '#475569' }}>#{r.id.slice(-6)}</span>
        </div>
        <div className="mt-0.5 text-xs" style={{ color: '#e9d5ff' }}>
          {t('admin.live.host')} {r.host ?? <span style={{ color: '#64748b' }}>—</span>}
        </div>
      </div>
      {dice.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {dice.map((s, i) => (
              <img
                key={i}
                src={symbolSrc(s)}
                alt={s}
                className="h-7 w-7 rounded object-contain"
                style={{ border: '1px solid #312e81', background: '#1e1b4b' }}
              />
            ))}
          </div>
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold " style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}>
            {t('admin.live.settled.sum', { n: r.diceSum ?? '—' })}
          </span>
        </div>
      ) : (
        <span className="text-[10px]" style={{ color: '#64748b' }}>{t('admin.live.noResult')}</span>
      )}
    </div>
  )
}

// Formats a UTC ISO string as date + time in GMT+7 for display.
function fmtGMT7(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    ...opts,
  })
}

// Returns the local-time value for a <input type="date"> and <input type="time">
// pre-filled from a UTC ISO string, displayed in GMT+7.
function isoToGMT7DateInput(iso: string): string {
  // e.g. "2026-05-19"
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}
function isoToGMT7TimeInput(iso: string): string {
  // e.g. "20:00"
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false })
}


function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    BETTING: { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' },
    LOCKED: { bg: 'rgba(234,88,12,0.2)', color: '#fdba74' },
    AWAITING_RESULT: { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' },
    RESOLVED: { bg: 'rgba(99,102,241,0.2)', color: '#a5b4fc' },
    CANCELLED: { bg: 'rgba(220,38,38,0.2)', color: '#f87171' },
  }
  const s = map[status] ?? map.RESOLVED
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold "
      style={{ background: s.bg, color: s.color }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
