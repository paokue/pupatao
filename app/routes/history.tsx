import { useEffect, useMemo, useState } from 'react'
import { useLoaderData, useNavigate } from 'react-router'
import type { Route } from './+types/history'
import type { BetKind, BetResult, GameMode, RangeKey } from '@prisma/client'
import { requireUser } from '~/lib/auth.server'
import { prisma } from '~/lib/prisma.server'
import { playClick } from '~/hooks/use-sound-engine'
import { useT } from '~/lib/use-t'

type SymbolKey = 'fish' | 'prawn' | 'crab' | 'rooster' | 'gourd' | 'frog'

const RANGE_BOUNDS: Record<RangeKey, { min: number; max: number }> = {
  LOW: { min: 3, max: 8 },
  MIDDLE: { min: 9, max: 10 },
  HIGH: { min: 11, max: 18 },
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — pulls Bet rows for the customer's REAL wallet, groups by round,
// derives per-bet payout / per-round totals so the page can render purely
// from the server payload.
// ─────────────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const wallet = await prisma.wallet.findUnique({
    where: { userId_type: { userId: user.id, type: 'REAL' } },
    select: { id: true },
  })
  if (!wallet) {
    throw new Response('Real wallet not found.', { status: 500 })
  }

  // 500 most recent bets — generous enough for now; if a player accumulates
  // more we'll add proper pagination.
  const bets = await prisma.bet.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      round: {
        select: {
          id: true,
          mode: true,
          dice1: true, dice2: true, dice3: true,
          diceSum: true,
          resolvedAt: true,
          createdAt: true,
        },
      },
    },
  })

  type RoundRecord = {
    id: string
    mode: GameMode
    timestamp: string
    dice: SymbolKey[]
    diceSum: number
    totalStake: number
    totalPayout: number
    netResult: number
    isWin: boolean
    bets: Array<{
      id: string
      kind: BetKind
      amount: number
      payout: number | null
      result: BetResult | null
      symbol: SymbolKey | null
      pairA: SymbolKey | null
      pairB: SymbolKey | null
      range: RangeKey | null
    }>
  }

  const grouped = new Map<string, RoundRecord>()
  for (const b of bets) {
    if (!b.round) continue
    const r = b.round
    if (!grouped.has(r.id)) {
      const dice: SymbolKey[] = [r.dice1, r.dice2, r.dice3]
        .filter(Boolean)
        .map(d => (d as string).toLowerCase() as SymbolKey)
      grouped.set(r.id, {
        id: r.id,
        mode: r.mode,
        timestamp: (r.resolvedAt ?? r.createdAt).toISOString(),
        dice,
        diceSum: r.diceSum ?? 0,
        totalStake: 0,
        totalPayout: 0,
        netResult: 0,
        isWin: false,
        bets: [],
      })
    }
    const rec = grouped.get(r.id)!
    rec.totalStake += b.amount
    rec.totalPayout += b.payout ?? 0
    rec.bets.push({
      id: b.id,
      kind: b.kind,
      amount: b.amount,
      payout: b.payout,
      result: b.result,
      symbol: b.symbol ? (b.symbol.toLowerCase() as SymbolKey) : null,
      pairA: b.pairA ? (b.pairA.toLowerCase() as SymbolKey) : null,
      pairB: b.pairB ? (b.pairB.toLowerCase() as SymbolKey) : null,
      range: b.range,
    })
  }
  for (const rec of grouped.values()) {
    rec.netResult = rec.totalPayout - rec.totalStake
    rec.isWin = rec.netResult > 0
  }

  const records = Array.from(grouped.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )

  const totalRounds = records.length
  const wins = records.filter(r => r.isWin).length
  const winRate = totalRounds ? Math.round((wins / totalRounds) * 100) : 0
  const netPL = records.reduce((s, r) => s + r.netResult, 0)

  return {
    records,
    stats: { totalRounds, wins, winRate, netPL },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

type Round = ReturnType<typeof useLoaderData<typeof loader>>['records'][number]

type ResultFilter = 'all' | 'win' | 'loss'
type ModeFilter = 'all' | GameMode
type KindFilter = 'all' | BetKind

export default function HistoryPage() {
  const { records, stats } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const t = useT()

  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  // Client-side pagination — 10 per click. Reset whenever a filter changes.
  const PAGE_INITIAL = 10
  const PAGE_STEP = 10
  const [visibleCount, setVisibleCount] = useState(PAGE_INITIAL)
  useEffect(() => { setVisibleCount(PAGE_INITIAL) }, [resultFilter, modeFilter, kindFilter])

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (resultFilter === 'win' && !r.isWin) return false
      if (resultFilter === 'loss' && r.isWin) return false
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false
      if (kindFilter !== 'all' && !r.bets.some(b => b.kind === kindFilter)) return false
      return true
    })
  }, [records, resultFilter, modeFilter, kindFilter])

  // Slice to current pagination window before grouping, so the date dividers
  // only reflect the rows actually rendered.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length
  const remaining = Math.max(0, filtered.length - visibleCount)

  // Date dividers — group consecutive rows that fall on the same calendar day.
  const grouped = useMemo(() => {
    const groups: { day: string; items: Round[] }[] = []
    for (const r of visible) {
      const day = new Date(r.timestamp).toLocaleDateString()
      const last = groups[groups.length - 1]
      if (!last || last.day !== day) groups.push({ day, items: [r] })
      else last.items.push(r)
    }
    return groups
  }, [visible])

  return (
    <div className="min-h-screen font-sans" style={{ background: '#7c3aed' }}>
      <header
        className="flex items-center gap-4 px-4 py-3"
        style={{ background: '#1e0040', borderBottom: '2px solid #a78bfa' }}
      >
        <button
          onClick={() => { playClick(); navigate('/') }}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
        >
          {`← ${t('common.back')}`}
        </button>
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('history.title')}</h1>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        {/* ─── Lifetime stats ─────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'linear-gradient(135deg, #4c1d95, #1e0040)', border: '2px solid #a78bfa' }}
        >
          <div className="mb-3 text-center text-xs font-bold tracking-widest" style={{ color: '#c4b5fd' }}>
            {t('history.lifetimeStats')}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>{t('history.totalGames')}</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: '#fde68a' }}>{stats.totalRounds.toLocaleString()}</div>
            </div>
            <div className="border-x text-center" style={{ borderColor: '#6d28d9' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>{t('history.winRate')}</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: '#4ade80' }}>{stats.winRate}%</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>{t('history.netPL')}</div>
              <div
                className="mt-1 text-2xl font-bold"
                style={{ color: stats.netPL > 0 ? '#4ade80' : stats.netPL < 0 ? '#f87171' : '#fde68a' }}
              >
                {stats.netPL > 0 ? '+' : ''}{stats.netPL.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Filters — three selects laid out flex on every breakpoint ── */}
        {records.length > 0 && (
          <div
            className="flex flex-col gap-2 rounded-xl p-3 sm:flex-row sm:flex-wrap"
            style={{ background: '#1e0040', border: '1px solid #4c1d95' }}
          >
            <FilterSelect
              label={t('history.filter.result')}
              value={resultFilter}
              onChange={v => setResultFilter(v as ResultFilter)}
              options={[
                { value: 'all', label: t('history.filter.allResults') },
                { value: 'win', label: t('history.filterWin') },
                { value: 'loss', label: t('history.filterLoss') },
              ]}
            />
            <FilterSelect
              label={t('history.filter.mode')}
              value={modeFilter}
              onChange={v => setModeFilter(v as ModeFilter)}
              options={[
                { value: 'all', label: t('history.filter.allModes') },
                { value: 'RANDOM', label: t('history.modeRandom') },
                { value: 'LIVE', label: t('history.modeLive') },
              ]}
            />
            <FilterSelect
              label={t('history.filter.kind')}
              value={kindFilter}
              onChange={v => setKindFilter(v as KindFilter)}
              options={[
                { value: 'all', label: t('history.filter.allKinds') },
                { value: 'SYMBOL', label: t('history.kind.single') },
                { value: 'PAIR', label: t('history.kind.pair') },
                { value: 'RANGE', label: t('history.kind.range') },
              ]}
            />
          </div>
        )}

        {/* ─── Empty state ───────────────────────────────────────────── */}
        {records.length === 0 && (
          <div
            className="rounded-2xl py-16 text-center"
            style={{ background: '#1e0040', border: '2px solid #4c1d95' }}
          >
            <p className="text-base font-semibold" style={{ color: '#a78bfa' }}>{t('history.empty')}</p>
            <p className="mt-1 text-sm" style={{ color: '#6d28d9' }}>{t('history.emptyHint')}</p>
            <button
              onClick={() => { playClick(); navigate('/') }}
              className="mt-4 rounded-xl px-6 py-2 text-sm font-bold"
              style={{ background: '#7c3aed', color: '#fff' }}
            >
              {t('history.playNow')}
            </button>
          </div>
        )}

        {/* ─── Grouped rows ──────────────────────────────────────────── */}
        {grouped.map(group => (
          <section key={group.day} className="flex flex-col gap-3">
            <div
              className="sticky top-0 z-10 -mx-4 px-4 py-1 text-[10px] font-bold tracking-widest"
              style={{ color: '#c4b5fd', background: 'rgba(124,58,237,0.85)' }}
            >
              {group.day}
            </div>
            {group.items.map(r => (
              <GameRow key={r.id} round={r} />
            ))}
          </section>
        ))}

        {/* ─── Load more ─────────────────────────────────────────────── */}
        {hasMore && (
          <button
            type="button"
            onClick={() => { playClick(); setVisibleCount(c => c + PAGE_STEP) }}
            className="rounded-xl py-3 text-sm font-bold tracking-widest transition-opacity hover:opacity-90"
            style={{ background: '#4c1d95', color: '#e9d5ff', border: '2px dashed #7c3aed' }}
          >
            {t('common.loadMoreCount', { n: Math.min(PAGE_STEP, remaining) })}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 sm:min-w-[140px]">
      <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-md px-2.5 py-2 text-xs font-semibold outline-none"
        style={{
          background: '#2d1b4e',
          color: '#fde68a',
          border: '1.5px solid #4c1d95',
          colorScheme: 'dark',
          appearance: 'none',
          WebkitAppearance: 'none',
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%23a78bfa' d='M0 0l5 6 5-6z'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
          paddingRight: '1.75rem',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: '#1e0040', color: '#fde68a' }}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function GameRow({ round }: { round: Round }) {
  const t = useT()
  const isWin = round.isWin
  const lossAmount = round.totalStake - round.totalPayout

  // Distinct kinds present in this round, ordered consistently — used by the
  // body to label each bet section.
  const kindOrder: BetKind[] = ['SYMBOL', 'PAIR', 'RANGE']
  const kindsPresent = kindOrder.filter(k => round.bets.some(b => b.kind === k))
  const kindLabel: Record<BetKind, string> = {
    SYMBOL: t('history.kind.single'),
    PAIR: t('history.kind.pair'),
    RANGE: t('history.kind.range'),
  }

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: '#1e0040',
        border: `2px solid ${isWin ? '#16a34a' : '#7f1d1d'}`,
      }}
    >
      {/* Header row — date + mode pill on the left, win/loss pill on the right.
          The kinds badge is intentionally omitted here; each kind is labeled
          on its own bet section below. */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2"
        style={{ background: isWin ? 'rgba(22,163,74,0.15)' : 'rgba(127,29,29,0.25)' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: '#a78bfa' }}>
            {new Date(round.timestamp).toLocaleString()}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
            style={{
              background: round.mode === 'LIVE' ? 'rgba(220,38,38,0.25)' : 'rgba(99,102,241,0.25)',
              color: round.mode === 'LIVE' ? '#fca5a5' : '#a5b4fc',
              border: `1px solid ${round.mode === 'LIVE' ? '#fca5a5' : '#a5b4fc'}`,
            }}
          >
            {round.mode === 'LIVE' ? t('history.modeLive') : t('history.modeRandom')}
          </span>
        </div>
        <span
          className="rounded-full px-3 py-0.5 text-xs font-bold uppercase whitespace-nowrap"
          style={{
            background: isWin ? '#16a34a' : '#dc2626',
            color: '#fff',
          }}
        >
          {isWin
            ? t('history.win', { amount: round.netResult.toLocaleString() })
            : t('history.loss', { amount: lossAmount.toLocaleString() })}
        </span>
      </div>

      {/* Dice + sum + total bet */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex gap-1.5">
          {round.dice.map((sym, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-lg bg-white shadow"
              style={{ width: 40, height: 40, border: '2px solid #f59e0b' }}
            >
              <img src={`/symbols/${sym}.jpg`} alt={sym} className="absolute inset-0 h-full w-full object-contain p-0.5" />
            </div>
          ))}
        </div>
        <div className="rounded-full px-3 py-0.5 text-xs font-bold" style={{ background: '#4c1d95', color: '#fde68a' }}>
          {t('history.sum')} {round.diceSum}
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px]" style={{ color: '#a78bfa' }}>{t('history.totalBet')}</div>
          <div className="text-sm font-bold" style={{ color: '#fde68a' }}>{round.totalStake.toLocaleString()}</div>
        </div>
      </div>

      {/* Bet sections — single, pair, range */}
      <div className="flex flex-col gap-2 px-4 pb-3">
        {kindsPresent.map(kind => (
          <BetSection key={kind} title={kindLabel[kind]}>
            {round.bets
              .filter(b => b.kind === kind)
              .map(b => (
                <BetTile key={b.id} bet={b} dice={round.dice} diceSum={round.diceSum} />
              ))}
          </BetSection>
        ))}
      </div>
    </div>
  )
}

function BetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>
        {title}
      </div>
      <div className="flex flex-wrap justify-start gap-1.5">{children}</div>
    </div>
  )
}

function BetTile({
  bet,
  dice,
  diceSum,
}: {
  bet: Round['bets'][number]
  dice: SymbolKey[]
  diceSum: number
}) {
  const t = useT()

  // Determine if this bet won — prefer server-recorded `result`, fall back to
  // recomputing client-side for legacy rounds where result wasn't stored.
  const won: boolean =
    bet.result === 'WIN' ||
    (bet.result == null && (
      (bet.kind === 'SYMBOL' && !!bet.symbol && dice.includes(bet.symbol))
      || (bet.kind === 'PAIR' && !!bet.pairA && !!bet.pairB && dice.includes(bet.pairA) && dice.includes(bet.pairB))
      || (bet.kind === 'RANGE' && !!bet.range && diceSum >= RANGE_BOUNDS[bet.range].min && diceSum <= RANGE_BOUNDS[bet.range].max)
    ))
  const payout = bet.payout ?? 0
  const profit = payout - bet.amount

  // Tile styling — green border + glow when this bet matched the result,
  // dim red border otherwise.
  const baseStyle = won
    ? { background: 'rgba(22,163,74,0.18)', border: '1.5px solid #4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.4)' }
    : { background: 'rgba(127,29,29,0.18)', border: '1.5px solid #7f1d1d' }

  if (bet.kind === 'SYMBOL' && bet.symbol) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={baseStyle}>
        <div className="relative h-6 w-6 overflow-hidden rounded bg-white">
          <img src={`/symbols/${bet.symbol}.jpg`} alt={bet.symbol} className="absolute inset-0 h-full w-full object-contain" />
        </div>
        <span className="text-xs font-semibold" style={{ color: '#fde68a' }}>{bet.amount.toLocaleString()}</span>
        <PayoutBadge won={won} profit={profit} />
      </div>
    )
  }

  if (bet.kind === 'PAIR' && bet.pairA && bet.pairB) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={baseStyle}>
        <div className="flex items-center gap-1">
          <div className="relative h-6 w-6 overflow-hidden rounded bg-white">
            <img src={`/symbols/${bet.pairA}.jpg`} alt={bet.pairA} className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <span className="text-[10px] font-bold" style={{ color: '#a78bfa' }}>+</span>
          <div className="relative h-6 w-6 overflow-hidden rounded bg-white">
            <img src={`/symbols/${bet.pairB}.jpg`} alt={bet.pairB} className="absolute inset-0 h-full w-full object-contain" />
          </div>
        </div>
        <span className="text-xs font-semibold" style={{ color: '#fde68a' }}>{bet.amount.toLocaleString()}</span>
        <PayoutBadge won={won} profit={profit} />
      </div>
    )
  }

  if (bet.kind === 'RANGE' && bet.range) {
    const label =
      bet.range === 'LOW' ? t('history.range.low')
      : bet.range === 'MIDDLE' ? t('history.range.middle')
      : t('history.range.high')
    const bg =
      bet.range === 'LOW' ? 'linear-gradient(135deg, #0369a1, #0c4a6e)'
      : bet.range === 'MIDDLE' ? 'linear-gradient(135deg, #a21caf, #581c87)'
      : 'linear-gradient(135deg, #b91c1c, #7f1d1d)'
    const border = won ? '#4ade80' : '#4c1d95'
    const range = RANGE_BOUNDS[bet.range]
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold"
        style={{ background: bg, color: '#fff', border: `1.5px solid ${border}`, boxShadow: won ? '0 0 8px rgba(74,222,128,0.4)' : undefined }}
      >
        <span>{label} ({range.min}-{range.max})</span>
        <span style={{ color: '#fde68a' }}>· {bet.amount.toLocaleString()}</span>
        <PayoutBadge won={won} profit={profit} compact />
      </div>
    )
  }

  return null
}

function PayoutBadge({ won, profit, compact }: { won: boolean; profit: number; compact?: boolean }) {
  const t = useT()
  if (won && profit > 0) {
    return (
      <span
        className={`rounded-full ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'} font-bold tracking-widest`}
        style={{ background: 'rgba(22,163,74,0.9)', color: '#fff' }}
      >
        {t('history.won', { amount: profit.toLocaleString() })}
      </span>
    )
  }
  return (
    <span
      className={`rounded-full ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'} font-bold tracking-widest`}
      style={{ background: 'rgba(127,29,29,0.6)', color: '#fda4af' }}
    >
      {t('history.lost')}
    </span>
  )
}
