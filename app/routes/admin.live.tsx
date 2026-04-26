import { useState } from 'react'
import { Form, useLoaderData, useNavigation } from 'react-router'
import { Check, Loader, Lock, PlayCircle, Radio, X } from 'lucide-react'
import type { DiceSymbol } from '@prisma/client'
import type { Route } from './+types/admin.live'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'

const SYMBOL_VALUE: Record<DiceSymbol, number> = {
  PRAWN: 1, CRAB: 2, FISH: 3, ROOSTER: 4, FROG: 5, GOURD: 6,
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
    history: history.map(serialize),
    lastStreamUrl: lastWithStream?.streamUrl ?? '',
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

      const streamUrl = String(fd.get('streamUrl') ?? '').trim() || null
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
      return { ok: true }
    }

    const roundId = String(fd.get('roundId') ?? '')
    if (!roundId) return { error: 'roundId required' }

    const round = await prisma.gameRound.findUnique({ where: { id: roundId } })
    if (!round) return { error: 'Round not found.' }

    if (op === 'updateStream') {
      const streamUrl = String(fd.get('streamUrl') ?? '').trim() || null
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

    if (op === 'resolve') {
      if (round.status === 'RESOLVED' || round.status === 'CANCELLED') {
        return { error: 'Round already finalised.' }
      }
      const dice1 = String(fd.get('dice1') ?? '') as DiceSymbol
      const dice2 = String(fd.get('dice2') ?? '') as DiceSymbol
      const dice3 = String(fd.get('dice3') ?? '') as DiceSymbol
      if (!SYMBOLS.includes(dice1) || !SYMBOLS.includes(dice2) || !SYMBOLS.includes(dice3)) {
        return { error: 'Pick a symbol for all 3 dice.' }
      }
      const diceSum = SYMBOL_VALUE[dice1] + SYMBOL_VALUE[dice2] + SYMBOL_VALUE[dice3]
      await prisma.$transaction([
        prisma.gameRound.update({
          where: { id: roundId },
          data: {
            status: 'RESOLVED',
            dice1, dice2, dice3, diceSum,
            resolvedAt: new Date(),
          },
        }),
        prisma.auditLog.create({
          data: {
            actorId: admin.id,
            action: 'round.resolve',
            target: `round:${roundId}`,
            metadata: { dice1, dice2, dice3, diceSum },
          },
        }),
      ])
      return { ok: true }
    }

    if (op === 'cancel') {
      if (round.status === 'RESOLVED' || round.status === 'CANCELLED') {
        return { error: 'Round already finalised.' }
      }
      await prisma.$transaction([
        prisma.gameRound.update({
          where: { id: roundId },
          data: { status: 'CANCELLED', resolvedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: { actorId: admin.id, action: 'round.cancel', target: `round:${roundId}` },
        }),
      ])
      return { ok: true }
    }

    return { error: 'Unknown op' }
  } catch (err) {
    console.error('[admin/live]', err)
    return { error: err instanceof Error ? err.message : 'Action failed.' }
  }
}

export default function AdminLive() {
  const { current, history, lastStreamUrl } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const loading = navigation.state !== 'idle'

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

      {/* ─── Stream + active round (or start form) ───────────────────── */}
      {current ? (
        <ActiveRoundPanel round={current} loading={loading} />
      ) : (
        <StartRoundPanel defaultStreamUrl={lastStreamUrl} loading={loading} />
      )}

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

// ─────────────────────────────────────────────────────────────────────────────

type CurrentRound = NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['current']>
type HistoryRound = ReturnType<typeof useLoaderData<typeof loader>>['history'][number]

function ActiveRoundPanel({ round, loading }: { round: CurrentRound; loading: boolean }) {
  const [d1, setD1] = useState<DiceSymbol | ''>(round.dice1 ?? '')
  const [d2, setD2] = useState<DiceSymbol | ''>(round.dice2 ?? '')
  const [d3, setD3] = useState<DiceSymbol | ''>(round.dice3 ?? '')
  const allPicked = !!d1 && !!d2 && !!d3
  const liveSum = allPicked ? SYMBOL_VALUE[d1 as DiceSymbol] + SYMBOL_VALUE[d2 as DiceSymbol] + SYMBOL_VALUE[d3 as DiceSymbol] : null

  return (
    <div className="flex flex-col gap-4">
      {/* Stream embed */}
      <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>LIVE STREAM</span>
          <StatusPill status={round.status} />
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
          {[
            { label: 'Dice 1', value: d1, set: setD1 },
            { label: 'Dice 2', value: d2, set: setD2 },
            { label: 'Dice 3', value: d3, set: setD3 },
          ].map(slot => (
            <DiceSlot key={slot.label} label={slot.label} value={slot.value} onChange={slot.set} />
          ))}
        </div>

        {allPicked && (
          <div className="mt-3 text-center text-xs" style={{ color: '#a5b4fc' }}>
            Sum: <span className="font-bold" style={{ color: '#fde68a' }}>{liveSum}</span>
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

          <Form method="post" className="inline">
            <input type="hidden" name="op" value="resolve" />
            <input type="hidden" name="roundId" value={round.id} />
            <input type="hidden" name="dice1" value={d1} />
            <input type="hidden" name="dice2" value={d2} />
            <input type="hidden" name="dice3" value={d3} />
            <button
              type="submit"
              disabled={!allPicked || loading}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-widest disabled:opacity-30"
              style={{ background: '#14532d', color: '#fff', border: '1px solid #4ade80' }}
            >
              {loading ? <Loader size={10} className="animate-spin" /> : <Check size={10} />}
              SUBMIT
            </button>
          </Form>

          <Form method="post" className="ml-auto inline">
            <input type="hidden" name="op" value="cancel" />
            <input type="hidden" name="roundId" value={round.id} />
            <button
              type="submit"
              disabled={loading}
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
  const embedUrl = yt ? `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1` : url

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
