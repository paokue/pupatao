import { useEffect, useState } from 'react'
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { Check, Loader, Lock, PlayCircle, Radio, Users as UsersIcon, X } from 'lucide-react'
import type { DiceSymbol } from '@prisma/client'
import type { Route } from './+types/admin.live'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyPresenceLive, notifyUser } from '~/lib/pusher.server'
import {
  ADMIN_CHANNEL,
  PRESENCE_LIVE,
  type BetPlacedPayload,
  type RoundDicePayload,
  type RoundResolvedPayload,
} from '~/lib/pusher-channels'
import { usePresenceMembers, usePusherEvent } from '~/hooks/use-pusher'

const SYMBOL_VALUE: Record<DiceSymbol, number> = {
  PRAWN: 1, CRAB: 2, FISH: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
}
const RANGE_BOUNDS: Record<'LOW' | 'MIDDLE' | 'HIGH', { min: number; max: number; multiplier: number }> = {
  LOW: { min: 3, max: 8, multiplier: 2 },
  MIDDLE: { min: 9, max: 10, multiplier: 4 },
  HIGH: { min: 11, max: 18, multiplier: 2 },
}
const PAIR_MULTIPLIER = 6

// Mirrors the per-bet payout math in api.play-round.tsx so server-side resolve
// produces the same numbers as a client-rolled RANDOM round would.
function computeBetPayout(
  b: { kind: string; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null },
  dice: DiceSymbol[],
  diceSum: number,
): number {
  if (b.kind === 'SYMBOL' && b.symbol) {
    const matches = dice.filter(d => d === b.symbol).length
    return matches > 0 ? b.amount * (matches + 1) : 0
  }
  if (b.kind === 'RANGE' && b.range) {
    const cfg = RANGE_BOUNDS[b.range as 'LOW' | 'MIDDLE' | 'HIGH']
    if (!cfg) return 0
    return diceSum >= cfg.min && diceSum <= cfg.max ? b.amount * cfg.multiplier : 0
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    return dice.includes(b.pairA as DiceSymbol) && dice.includes(b.pairB as DiceSymbol)
      ? b.amount * PAIR_MULTIPLIER
      : 0
  }
  return 0
}
// Asset filenames live at /symbols/<lowercase>.jpg — same files the player view uses.
const SYMBOL_FILE: Record<DiceSymbol, string> = {
  FISH: 'fish', PRAWN: 'prawn', CRAB: 'crab', ROOSTER: 'rooster', GOURD: 'gourd', FROG: 'frog',
}
const SYMBOLS: DiceSymbol[] = ['FISH', 'PRAWN', 'CRAB', 'ROOSTER', 'GOURD', 'FROG']

function symbolSrc(s: DiceSymbol): string {
  return `/symbols/${SYMBOL_FILE[s]}.jpg`
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
  const currentBets = current
    ? await prisma.bet.findMany({
        where: { roundId: current.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { tel: true, firstName: true, lastName: true } } },
      })
    : []

  // Round history — most recent finished/cancelled rounds (and any extra
  // active ones not picked up above, just in case more than one was opened).
  const history = await prisma.gameRound.findMany({
    where: { mode: 'LIVE', NOT: current ? { id: current.id } : undefined },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      host: { select: { email: true, firstName: true, lastName: true } },
      _count: { select: { bets: true } },
    },
  })

  // Prefill stream URL with the last one we saw, so admin doesn't retype it.
  const lastWithStream = await prisma.gameRound.findFirst({
    where: { mode: 'LIVE', streamUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { streamUrl: true },
  })

  function serialize(r: typeof history[number]) {
    return {
      id: r.id,
      status: r.status,
      streamUrl: r.streamUrl,
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
      kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR',
      amount: b.amount,
      symbol: b.symbol,
      range: b.range,
      pairA: b.pairA,
      pairB: b.pairB,
      createdAt: b.createdAt.toISOString(),
      userId: b.userId,
      userTel: b.user.tel,
      userName: [b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || null,
    })),
    history: history.map(serialize),
    lastStreamUrl: lastWithStream?.streamUrl ?? '',
  }
}

// Shape used by both the seeded bets (from the loader) and the realtime feed.
type LiveBet = {
  id: string
  kind: 'SYMBOL' | 'RANGE' | 'PAIR'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  createdAt: string
  userId: string
  userTel: string
  userName: string | null
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
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')

  try {
    if (op === 'startRound') {
      // Refuse if a round is already in flight.
      const existing = await prisma.gameRound.findFirst({
        where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } },
        select: { id: true },
      })
      if (existing) return { error: 'A LIVE round is already in flight. Resolve or cancel it first.' }

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
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'round.start', target: `round:${round.id}`, metadata: { seconds, streamUrl } },
      })
      const startedPayload = {
        roundId: round.id,
        streamUrl: streamUrl,
        bettingClosesAt: bettingClosesAt.toISOString(),
      }
      // Broadcast to BOTH channels so every open customer page (presence-live)
      // and every admin tab (private-admin) revalidates without a manual refresh.
      notifyPresenceLive('round:started', startedPayload)
      notifyAdmin('round:started', startedPayload)
      return { ok: true }
    }

    const roundId = String(fd.get('roundId') ?? '')
    if (!roundId) return { error: 'roundId required' }

    const round = await prisma.gameRound.findUnique({ where: { id: roundId } })
    if (!round) return { error: 'Round not found.' }

    if (op === 'updateStream') {
      const rawStreamUrl = String(fd.get('streamUrl') ?? '').trim() || null
      const streamUrl = await normalizeStreamUrl(rawStreamUrl)
      await prisma.gameRound.update({ where: { id: roundId }, data: { streamUrl } })
      return { ok: true }
    }

    if (op === 'lock') {
      if (round.status !== 'BETTING') return { error: 'Only an open round can be locked.' }
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
        return { error: 'Round already finalised.' }
      }
      const dieIndexRaw = String(fd.get('dieIndex') ?? '')
      const symbol = String(fd.get('symbol') ?? '') as DiceSymbol
      if (dieIndexRaw !== '1' && dieIndexRaw !== '2' && dieIndexRaw !== '3') {
        return { error: 'Invalid dieIndex.' }
      }
      if (!SYMBOLS.includes(symbol)) return { error: 'Invalid symbol.' }
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
        return { error: 'Round already finalised.' }
      }
      // Dice come from the DB now (set incrementally via `revealDie`), so the
      // settlement payload no longer carries them. Refresh the round to pick
      // up any picks made since the action started.
      const fresh = await prisma.gameRound.findUnique({ where: { id: roundId }, select: { dice1: true, dice2: true, dice3: true } })
      const dice1 = fresh?.dice1 as DiceSymbol | null
      const dice2 = fresh?.dice2 as DiceSymbol | null
      const dice3 = fresh?.dice3 as DiceSymbol | null
      if (!dice1 || !dice2 || !dice3 || !SYMBOLS.includes(dice1) || !SYMBOLS.includes(dice2) || !SYMBOLS.includes(dice3)) {
        return { error: 'Pick a symbol for all 3 dice before settling.' }
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
        select: { id: true, userId: true, walletId: true, kind: true, amount: true, symbol: true, range: true, pairA: true, pairB: true, user: { select: { tel: true, firstName: true, lastName: true } } },
      })

      type Resolved = { id: string; payout: number; result: 'WIN' | 'LOSS' }
      const betUpdates: Resolved[] = bets.map(b => {
        const payout = computeBetPayout(b, dice, diceSum)
        return { id: b.id, payout, result: payout > 0 ? 'WIN' : 'LOSS' }
      })

      // Per-player aggregates — used both for the wallet credit (winning
      // wallets only) and the admin summary panel (everyone who bet).
      type Group = {
        userId: string
        walletId: string
        userTel: string
        userName: string | null
        stake: number   // sum of all stakes this user placed
        payout: number  // sum of winning payouts (0 if all lost)
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
            userTel: b.user.tel,
            userName: [b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || null,
            stake: 0,
            payout: 0,
          }
          playerGroups.set(key, grp)
        }
        grp.stake += b.amount
        if (u.payout > 0) grp.payout += u.payout
      })

      const resolvedAt = new Date()
      const newBalances = await prisma.$transaction(async db => {
        await db.gameRound.update({
          where: { id: roundId },
          data: { status: 'RESOLVED', dice1, dice2, dice3, diceSum, resolvedAt },
        })
        for (const u of betUpdates) {
          await db.bet.update({
            where: { id: u.id },
            data: { payout: u.payout, result: u.result, resolvedAt },
          })
        }
        const balances: Record<string, number> = {}
        for (const grp of playerGroups.values()) {
          const w = await db.wallet.findUnique({ where: { id: grp.walletId } })
          if (!w) continue
          balances[grp.userId] = w.balance  // default to current balance (no win)
          if (grp.payout <= 0) continue
          const newBalance = w.balance + grp.payout
          await db.wallet.update({
            where: { id: grp.walletId },
            data: { balance: newBalance, version: { increment: 1 } },
          })
          await db.transaction.create({
            data: {
              userId: grp.userId, walletId: grp.walletId, type: 'WIN',
              amount: grp.payout, balanceBefore: w.balance, balanceAfter: newBalance,
              status: 'COMPLETED', roundId, idempotencyKey: crypto.randomUUID(),
              note: `Live round payout (#${roundId.slice(-6)})`,
            },
          })
          balances[grp.userId] = newBalance
        }
        await db.auditLog.create({
          data: {
            actorId: admin.id,
            action: 'round.resolve',
            target: `round:${roundId}`,
            metadata: { dice1, dice2, dice3, diceSum, bets: bets.length, players: playerGroups.size },
          },
        })
        return balances
      })

      // Build per-user bet lists for the round:settled events. The customer's
      // result modal renders one row per bet so they see exactly what they
      // placed and how each bet resolved.
      const perUserBets = new Map<string, { kind: 'SYMBOL' | 'RANGE' | 'PAIR'; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; payout: number; result: 'WIN' | 'LOSS' }[]>()
      bets.forEach((b, i) => {
        const u = betUpdates[i]
        const list = perUserBets.get(b.userId) ?? []
        list.push({
          kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR',
          amount: b.amount,
          symbol: b.symbol,
          range: b.range,
          pairA: b.pairA,
          pairB: b.pairB,
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

      // Build the summary payload that the admin's UI panel renders.
      const players = Array.from(playerGroups.values()).map(grp => ({
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

      return {
        ok: true,
        summary: {
          roundId,
          dice: dice as string[],
          diceSum,
          totalBets: bets.length,
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
        return { error: 'Round already finalised.' }
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

      const refundedBalances = await prisma.$transaction(async db => {
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
        await db.auditLog.create({
          data: { actorId: admin.id, action: 'round.cancel', target: `round:${roundId}`, metadata: { refundedBets: bets.length, refundedWallets: refundGroups.size } },
        })
        return balances
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

    return { error: 'Unknown op' }
  } catch (err) {
    console.error('[admin/live]', err)
    return { error: err instanceof Error ? err.message : 'Action failed.' }
  }
}

export default function AdminLive() {
  const { current, currentBets, history, lastStreamUrl } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'

  // Presence: every customer (and admin) viewing the live page joins this
  // channel. We split admins out so the "viewers" count reflects customers only.
  const members = usePresenceMembers(PRESENCE_LIVE)
  const viewers = members.filter(m => m.info.kind === 'user')

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Live play</h1>
        {current && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
            style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #fca5a5' }}
          >
            <Radio size={10} className="animate-pulse" /> ROUND IN FLIGHT
          </span>
        )}
      </div>

      {/* ─── Stream + active round (or settled-summary + start form) ──── */}
      {current ? (
        <ActiveRoundPanel
          round={current}
          loading={loading}
          onSettle={settleRound}
          settling={resolveFetcher.state !== 'idle'}
          settleError={resolveFetcher.data?.error ?? null}
        />
      ) : (
        <>
          {settledSummary && (
            <SettledSummaryPanel
              summary={settledSummary}
              onClose={() => setSettledSummary(null)}
            />
          )}
          <StartRoundPanel defaultStreamUrl={lastStreamUrl} loading={loading} />
        </>
      )}

      {/* ─── Live presence + bets feed (only meaningful while a round is open) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ViewersPanel viewers={viewers} />
        <LiveBetsPanel bets={bets} hasOpenRound={!!current} roundId={current?.id ?? null} />
      </div>

      {/* ─── Round history ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-bold tracking-widest" style={{ color: '#a5b4fc' }}>ROUND HISTORY</h2>
        {history.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-xs"
            style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
          >
            No previous rounds.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map(r => (
              <HistoryRow key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SettledSummaryPanel({ summary, onClose }: { summary: ResolveSummary; onClose: () => void }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #4ade80' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-widest" style={{ color: '#4ade80' }}>
          <Check size={12} /> ROUND SETTLED · #{summary.roundId.slice(-6)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-[10px] font-bold tracking-widest"
          style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
        >
          CLOSE
        </button>
      </div>

      <div className="mb-3 flex items-center justify-center gap-2">
        {summary.dice.map((s, i) => (
          <img
            key={i}
            src={`/symbols/${s.toLowerCase()}.jpg`}
            alt={s}
            className="h-12 w-12 rounded object-contain"
            style={{ border: '1px solid #312e81', background: '#1e1b4b' }}
          />
        ))}
        <span className="ml-2 rounded-md px-3 py-1 text-[11px] font-bold tracking-widest" style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}>
          SUM {summary.diceSum}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: 'PLAYERS', value: summary.totalPlayers.toLocaleString() },
          { label: 'TOTAL STAKE', value: summary.totalStake.toLocaleString() },
          { label: 'TOTAL PAYOUT', value: summary.totalPayout.toLocaleString() },
          { label: 'HOUSE NET', value: `${summary.houseNet >= 0 ? '+' : ''}${summary.houseNet.toLocaleString()}`, color: summary.houseNet >= 0 ? '#4ade80' : '#f87171' },
        ].map(s => (
          <div key={s.label} className="rounded-md px-2 py-2 text-center" style={{ background: '#1e1b4b' }}>
            <div className="text-[9px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>{s.label}</div>
            <div className="mt-0.5 text-sm font-bold" style={{ color: s.color ?? '#fde68a' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {summary.players.length === 0 ? (
        <p className="text-center text-[11px]" style={{ color: '#475569' }}>No bets were placed in this round.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
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
                bal {p.newBalance.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ViewersPanel({ viewers }: { viewers: ReturnType<typeof usePresenceMembers> }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>
          <UsersIcon size={12} /> VIEWERS
        </span>
        <span className="text-[10px] font-bold" style={{ color: '#fde68a' }}>{viewers.length}</span>
      </div>
      {viewers.length === 0 ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>No customers watching live yet.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {viewers.map(v => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
              style={{ background: '#1e1b4b' }}
            >
              <span className="truncate" style={{ color: '#e9d5ff' }}>
                {v.info.name ?? v.info.tel ?? v.id}
              </span>
              <span className="text-[10px]" style={{ color: '#a5b4fc' }}>{v.info.tel ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LiveBetsPanel({
  bets,
  hasOpenRound,
  roundId,
}: {
  bets: LiveBet[]
  hasOpenRound: boolean
  roundId: string | null
}) {
  const totalStake = bets.reduce((sum, b) => sum + b.amount, 0)
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>
          <Radio size={12} /> LIVE BETS{roundId && <span className="text-[9px] font-mono" style={{ color: '#475569' }}>#{roundId.slice(-6)}</span>}
        </span>
        <span className="text-[10px]" style={{ color: '#fde68a' }}>
          {bets.length} bet{bets.length === 1 ? '' : 's'} · {totalStake.toLocaleString()} ₭
        </span>
      </div>
      {!hasOpenRound ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>Start a LIVE round to see bets stream in.</p>
      ) : bets.length === 0 ? (
        <p className="text-center text-[10px]" style={{ color: '#475569' }}>No bets in this round yet.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {bets.map(b => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
              style={{ background: '#1e1b4b' }}
            >
              <div className="min-w-0">
                <div className="truncate font-semibold" style={{ color: '#e9d5ff' }}>
                  {b.userName ? `${b.userName} · ` : ''}{b.userTel}
                </div>
                <div className="text-[10px]" style={{ color: '#a5b4fc' }}>{describeLiveBet(b)}</div>
              </div>
              <span className="shrink-0 font-bold" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function describeLiveBet(b: LiveBet): string {
  if (b.kind === 'SYMBOL' && b.symbol) return `Symbol · ${b.symbol}`
  if (b.kind === 'RANGE' && b.range) return `Range · ${b.range}`
  if (b.kind === 'PAIR' && b.pairA && b.pairB) return `Pair · ${b.pairA}+${b.pairB}`
  return b.kind
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
}: {
  round: CurrentRound
  loading: boolean
  onSettle: (roundId: string) => void
  settling: boolean
  settleError: string | null
}) {
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

  return (
    <div className="flex flex-col gap-4">
      {/* Stream embed */}
      <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>LIVE STREAM</span>
          <div className="flex items-center gap-2">
            {remainingSeconds != null && (
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest"
                style={{
                  background: bettingExpired ? 'rgba(234,88,12,0.2)' : remainingSeconds <= 10 ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)',
                  color: bettingExpired ? '#fdba74' : remainingSeconds <= 10 ? '#fca5a5' : '#4ade80',
                  border: `1px solid ${bettingExpired ? '#fb923c' : remainingSeconds <= 10 ? '#fca5a5' : '#4ade80'}`,
                }}
              >
                {bettingExpired ? '🔒 BETTING CLOSED' : `⏱ ${remainingSeconds}s`}
              </span>
            )}
            <StatusPill status={round.status} />
          </div>
        </div>
        <StreamEmbed url={round.streamUrl} />
        <Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="op" value="updateStream" />
          <input type="hidden" name="roundId" value={round.id} />
          <input
            name="streamUrl"
            defaultValue={round.streamUrl ?? ''}
            placeholder="Stream URL (YouTube, MP4, HLS, …)"
            className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md px-3 py-1.5 text-[10px] font-bold tracking-widest disabled:opacity-50"
            style={{ background: '#4338ca', color: '#fff', border: '1px solid #818cf8' }}
          >
            UPDATE STREAM
          </button>
        </Form>
      </div>

      {/* Result entry */}
      <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>ROUND RESULT</span>
          <span className="text-[10px]" style={{ color: '#818cf8' }}>{round.bets} bets · #{round.id.slice(-6)}</span>
        </div>

        {/* Mobile: 1 column, each die spans full width with 6 symbols across.
            md+: 3 columns side-by-side, each 2 rows of 3 symbols. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[1, 2, 3].map(idx => (
            <DiceSlot
              key={idx}
              label={`Dice ${idx}`}
              value={dice[idx - 1] ?? ''}
              onChange={s => pickDie(idx as 1 | 2 | 3, s)}
            />
          ))}
        </div>

        {allPicked && (
          <div className="mt-3 text-center text-xs" style={{ color: '#a5b4fc' }}>
            Sum: <span className="font-bold" style={{ color: '#fde68a' }}>{liveSum}</span>
          </div>
        )}

        {settleError && (
          <div className="mt-3 rounded-md px-3 py-2 text-center text-[11px]" style={{ background: 'rgba(220,38,38,0.2)', color: '#fca5a5', border: '1px solid #fca5a5' }}>
            {settleError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {round.status === 'BETTING' && (
            <Form method="post" className="inline">
              <input type="hidden" name="op" value="lock" />
              <input type="hidden" name="roundId" value={round.id} />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-widest disabled:opacity-50"
                style={{ background: '#1e1b4b', color: '#fdba74', border: '1px solid #fb923c' }}
              >
                {loading ? <Loader size={10} className="animate-spin" /> : <Lock size={10} />}
                LOCK BETTING
              </button>
            </Form>
          )}

          <button
            type="button"
            onClick={settle}
            disabled={!allPicked || submitting}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-widest disabled:opacity-30"
            style={{ background: '#14532d', color: '#fff', border: '1px solid #4ade80' }}
            title={allPicked ? 'Settle the round and credit winners' : 'Pick all 3 dice first'}
          >
            {submitting ? <Loader size={10} className="animate-spin" /> : <Check size={10} />}
            SUMMARY
          </button>

          <Form method="post" className="ml-auto inline">
            <input type="hidden" name="op" value="cancel" />
            <input type="hidden" name="roundId" value={round.id} />
            <button
              type="submit"
              disabled={loading || submitting}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-widest disabled:opacity-50"
              style={{ background: '#7f1d1d', color: '#fff', border: '1px solid #fca5a5' }}
            >
              {loading ? <Loader size={10} className="animate-spin" /> : <X size={10} />}
              CANCEL
            </button>
          </Form>
        </div>
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

function StartRoundPanel({ defaultStreamUrl, loading }: { defaultStreamUrl: string; loading: boolean }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>
        <Radio size={12} /> START NEW LIVE ROUND
      </div>
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="op" value="startRound" />

        <label className="text-[10px] font-semibold tracking-widest" style={{ color: '#a5b4fc' }}>STREAM URL</label>
        <input
          name="streamUrl"
          defaultValue={defaultStreamUrl}
          placeholder="YouTube, MP4, HLS, …"
          className="rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
        />

        <label className="text-[10px] font-semibold tracking-widest" style={{ color: '#a5b4fc' }}>BETTING WINDOW (SECONDS)</label>
        <input
          name="seconds"
          type="number"
          min={15}
          max={600}
          defaultValue={DEFAULT_BETTING_SECONDS}
          className="rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold tracking-widest disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: '1.5px solid #4ade80' }}
        >
          {loading ? <Loader size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          START ROUND
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
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-2"
      style={{ background: '#1e1b4b', border: '1px solid #312e81' }}
    >
      <div className="text-center text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>{label}</div>
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
              <span className="mt-0.5 text-[9px] font-bold tracking-widest" style={{ color: selected ? '#fde68a' : '#818cf8' }}>
                {SYMBOL_VALUE[s]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StreamEmbed({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div
        className="flex aspect-video items-center justify-center rounded-lg text-xs"
        style={{ background: '#1e1b4b', color: '#818cf8', border: '1px dashed #4338ca' }}
      >
        No stream URL set yet.
      </div>
    )
  }
  const isVideoFile = /\.(mp4|webm|mov)(\?|$)/i.test(url)
  const isHls = /\.m3u8(\?|$)/i.test(url)
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  // Facebook URLs can't be iframed directly (X-Frame-Options) — rewrite to
  // the plugin endpoint which DOES allow embedding.
  const isFb = /(?:facebook\.com|fb\.watch)/i.test(url)
  const embedUrl = yt
    ? `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1`
    : isFb
      ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true&mute=1`
      : url

  return (
    <div className="overflow-hidden rounded-lg" style={{ border: '1px solid #4338ca' }}>
      {isVideoFile || isHls ? (
        <video src={url} controls autoPlay muted playsInline className="aspect-video w-full bg-black" />
      ) : (
        <iframe
          src={embedUrl}
          title="LIVE stream"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full bg-black"
        />
      )}
    </div>
  )
}

function HistoryRow({ r }: { r: HistoryRound }) {
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
          <span className="text-xs" style={{ color: '#a5b4fc' }}>· {r.bets} bets</span>
          <span className="text-[10px]" style={{ color: '#475569' }}>#{r.id.slice(-6)}</span>
        </div>
        <div className="mt-0.5 text-xs" style={{ color: '#e9d5ff' }}>
          Host: {r.host ?? <span style={{ color: '#64748b' }}>—</span>}
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
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold tracking-widest" style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}>
            SUM {r.diceSum ?? '—'}
          </span>
        </div>
      ) : (
        <span className="text-[10px]" style={{ color: '#64748b' }}>no result</span>
      )}
    </div>
  )
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
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
      style={{ background: s.bg, color: s.color }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
