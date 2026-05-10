import { Form, Link, useLoaderData, useNavigation, useRevalidator, useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader, Search } from 'lucide-react'
import type { Route } from './+types/admin.play-history'
import type { WalletType } from '@prisma/client'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL, type BetPlacedPayload, type RoundResolvedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'

const PAGE_SIZE = 30
const WALLET_TABS: ReadonlyArray<Extract<WalletType, 'REAL' | 'DEMO'>> = ['REAL', 'DEMO']
const BET_TYPES: { key: 'ALL' | 'SYMBOL' | 'PAIR' | 'LOW' | 'MIDDLE' | 'HIGH'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'SYMBOL', label: 'Single' },
  { key: 'PAIR', label: 'Pair' },
  { key: 'LOW', label: 'Low' },
  { key: 'MIDDLE', label: 'Medium' },
  { key: 'HIGH', label: 'High' },
]

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const walletParam = url.searchParams.get('wallet')
  const walletType: 'REAL' | 'DEMO' = walletParam === 'DEMO' ? 'DEMO' : 'REAL'
  const q = url.searchParams.get('q')?.trim() ?? ''
  const resultParam = url.searchParams.get('result') ?? 'ALL'
  const betTypeParam = url.searchParams.get('betType') ?? 'ALL'
  const result: 'ALL' | 'WIN' | 'LOSS' = resultParam === 'WIN' ? 'WIN' : resultParam === 'LOSS' ? 'LOSS' : 'ALL'
  type BetTypeFilter = 'ALL' | 'SYMBOL' | 'PAIR' | 'LOW' | 'MIDDLE' | 'HIGH'
  const betType: BetTypeFilter = (['SYMBOL', 'PAIR', 'LOW', 'MIDDLE', 'HIGH'] as const).includes(betTypeParam as any) ? betTypeParam as BetTypeFilter : 'ALL'

  const resultWhere = result !== 'ALL' ? { result } : {}
  const betTypeWhere =
    betType === 'SYMBOL' ? { kind: 'SYMBOL' as const }
    : betType === 'PAIR' ? { kind: 'PAIR' as const }
    : betType === 'LOW' ? { kind: 'RANGE' as const, range: 'LOW' as const }
    : betType === 'MIDDLE' ? { kind: 'RANGE' as const, range: 'MIDDLE' as const }
    : betType === 'HIGH' ? { kind: 'RANGE' as const, range: 'HIGH' as const }
    : {}

  const where = {
    wallet: { is: { type: walletType } },
    ...resultWhere,
    ...betTypeWhere,
    ...(q ? { user: { is: { tel: { contains: q, mode: 'insensitive' as const } } } } : {}),
  }

  const [total, bets] = await Promise.all([
    prisma.bet.count({ where }),
    prisma.bet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { tel: true, firstName: true, lastName: true } },
        round: { select: { mode: true, status: true, dice1: true, dice2: true, dice3: true, diceSum: true } },
      },
    }),
  ])

  return {
    page,
    total,
    pageSize: PAGE_SIZE,
    walletType,
    q,
    result,
    betType,
    bets: bets.map(b => ({
      id: b.id,
      kind: b.kind,
      amount: b.amount,
      payout: b.payout,
      result: b.result,
      symbol: b.symbol,
      range: b.range,
      pairA: b.pairA,
      pairB: b.pairB,
      createdAt: b.createdAt.toISOString(),
      user: {
        tel: b.user.tel,
        name: [b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || null,
      },
      round: b.round
        ? {
          mode: b.round.mode,
          status: b.round.status,
          dice: [b.round.dice1, b.round.dice2, b.round.dice3].filter(Boolean) as string[],
          diceSum: b.round.diceSum,
        }
        : null,
    })),
  }
}

export default function AdminPlayHistory() {
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  // Each new bet (and every round resolution) re-fetches the page-1 list. We
  // skip revalidation when the admin is paginated past the first page, since
  // appending fresh rows would shift the pagination cursor under their feet.
  const onFirstPage = data.page === 1
  usePusherEvent<BetPlacedPayload>(ADMIN_CHANNEL, 'bet:placed', () => {
    if (onFirstPage) revalidator.revalidate()
  })
  usePusherEvent<RoundResolvedPayload>(ADMIN_CHANNEL, 'round:resolved', () => {
    if (onFirstPage) revalidator.revalidate()
  })

  function pageHref(p: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(p))
    return `?${next.toString()}`
  }

  function walletHref(w: 'REAL' | 'DEMO') {
    const next = new URLSearchParams(params)
    next.set('wallet', w)
    next.delete('page')
    return `?${next.toString()}`
  }

  function resultHref(r: 'ALL' | 'WIN' | 'LOSS') {
    const next = new URLSearchParams(params)
    next.set('result', r)
    next.delete('page')
    return `?${next.toString()}`
  }

  function betTypeHref(bt: string) {
    const next = new URLSearchParams(params)
    next.set('betType', bt)
    next.delete('page')
    return `?${next.toString()}`
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Play history</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{data.total.toLocaleString()} bets</span>
      </div>

      {/* ─── Wallet tabs — REAL vs DEMO ───────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid #4338ca' }}>
        {WALLET_TABS.map(w => {
          const active = data.walletType === w
          return (
            <Link
              key={w}
              to={walletHref(w)}
              className="flex-1 py-2 text-center text-xs font-bold  transition-all"
              style={{
                background: active ? '#4338ca' : '#0f172a',
                color: active ? '#fff' : '#a5b4fc',
              }}
            >
              {w === 'REAL' ? 'REAL ACCOUNT' : 'DEMO ACCOUNT'}
            </Link>
          )
        })}
      </div>

      {/* ─── Filters + Search ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 md:flex-row md:gap-4">
        {/* LEFT ½: result + bet-type filters */}
        <div className="flex flex-col gap-2 md:w-1/2">
          <div className="flex gap-1.5">
            {(['ALL', 'WIN', 'LOSS'] as const).map(r => (
              <Link
                key={r}
                to={resultHref(r)}
                className="rounded-md px-3 py-1 text-xs font-bold"
                style={{
                  background: data.result === r ? '#1e1b4b' : 'transparent',
                  color: data.result === r
                    ? (r === 'WIN' ? '#4ade80' : r === 'LOSS' ? '#f87171' : '#fde68a')
                    : '#818cf8',
                  border: `1px solid ${data.result === r ? '#4338ca' : '#1e1b4b'}`,
                }}
              >
                {r === 'ALL' ? 'All results' : r}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BET_TYPES.map(bt => (
              <Link
                key={bt.key}
                to={betTypeHref(bt.key)}
                className="rounded-md px-3 py-1 text-xs font-bold"
                style={{
                  background: data.betType === bt.key ? '#1e1b4b' : 'transparent',
                  color: data.betType === bt.key ? '#fde68a' : '#818cf8',
                  border: `1px solid ${data.betType === bt.key ? '#4338ca' : '#1e1b4b'}`,
                }}
              >
                {bt.label}
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT ½: phone search */}
        <Form method="get" className="flex items-center gap-2 md:w-1/2">
          <input type="hidden" name="wallet" value={data.walletType} />
          <input type="hidden" name="result" value={data.result} />
          <input type="hidden" name="betType" value={data.betType} />
          <input type="hidden" name="page" value="1" />
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#818cf8' }} />
            <input
              name="q"
              defaultValue={data.q}
              placeholder="Filter by phone number…"
              className="w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none"
              style={{ background: '#0f172a', color: '#fde68a', border: '1.5px solid #4338ca' }}
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-xs font-bold"
            style={{ background: '#4338ca', color: '#fff', border: '1.5px solid #818cf8' }}
          >
            {loading ? <Loader size={14} className="animate-spin" /> : 'SEARCH'}
          </button>
          {data.q && (
            <Link
              to={(() => {
                const next = new URLSearchParams(params)
                next.delete('q')
                next.delete('page')
                return `?${next.toString()}`
              })()}
              className="rounded-lg px-3 py-2 text-xs font-bold"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1.5px solid #4338ca' }}
            >
              CLEAR
            </Link>
          )}
        </Form>
      </div>

      {data.bets.length === 0 && (
        <div
          className="rounded-xl p-8 text-center text-xs"
          style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
        >
          No bets recorded yet.
        </div>
      )}

      {/* Mobile: cards */}
      {data.bets.length > 0 && (
        <div className="flex flex-col gap-2 md:hidden">
          {data.bets.map((b, i) => (
            <BetCard key={b.id} b={b} rowNum={(data.page - 1) * data.pageSize + i + 1} />
          ))}
        </div>
      )}

      {/* Desktop: table */}
      {data.bets.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl md:block" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <table className="w-full text-left text-sm">
            <thead style={{ color: '#a5b4fc' }}>
              <tr className="text-[10px] font-bold " style={{ background: '#1e1b4b' }}>
                <th className="w-8 px-3 py-2 text-right" style={{ color: '#64748b' }}>#</th>
                <th className="px-3 py-2">WHEN</th>
                <th className="px-3 py-2">PLAYER</th>
                <th className="px-3 py-2">BET</th>
                <th className="px-3 py-2">ROUND</th>
                <th className="px-3 py-2 text-right">STAKE</th>
                <th className="px-3 py-2 text-right">PAYOUT</th>
                <th className="px-3 py-2">RESULT</th>
              </tr>
            </thead>
            <tbody>
              {data.bets.map((b, i) => (
                <tr key={b.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                  <td className="px-3 py-2 text-right text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>{(data.page - 1) * data.pageSize + i + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: '#818cf8' }}>{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{b.user.name ? `${b.user.name} · ` : ''}{b.user.tel}</td>
                  <td className="px-3 py-2"><BetDescription b={b} /></td>
                  <td className="px-3 py-2 text-xs" style={{ color: '#a5b4fc' }}>
                    {b.round ? (
                      <div className="flex flex-col gap-0.5">
                        <span>{b.round.mode} · {b.round.status}</span>
                        {b.round.dice.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            {b.round.dice.map((d, i) => (
                              <SymbolImg key={i} symbol={d} size={16} />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right" style={{ color: b.payout && b.payout > 0 ? '#4ade80' : '#818cf8' }}>
                    {b.payout != null ? b.payout.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2"><ResultPill result={b.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            {data.page > 1 && (
              <Link to={pageHref(data.page - 1)} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>← Prev</Link>
            )}
            {data.page < totalPages && (
              <Link to={pageHref(data.page + 1)} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>Next →</Link>
            )}
          </div>
          <span className="text-xs tabular-nums" style={{ color: '#a5b4fc' }}>
            Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total).toLocaleString()} of {data.total.toLocaleString()} bets · Page {data.page}/{totalPages}
          </span>
        </div>
      )}
    </div>
  )
}

type Bet = ReturnType<typeof useLoaderData<typeof loader>>['bets'][number]

function SymbolImg({ symbol, size = 18 }: { symbol: string; size?: number }) {
  return (
    <img
      src={`/symbols/${symbol.toLowerCase()}.png`}
      alt={symbol}
      width={size}
      height={size}
      className="inline-block rounded object-contain"
      style={{ background: '#fff', padding: 1 }}
    />
  )
}

function BetDescription({ b }: { b: Bet }) {
  if (b.kind === 'SYMBOL' && b.symbol) {
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: '#e9d5ff' }}>
        <SymbolImg symbol={b.symbol} />
        <span style={{ color: '#a5b4fc' }}>Symbol</span>
        <span>·</span>
        <span>{b.symbol}</span>
      </span>
    )
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: '#e9d5ff' }}>
        <SymbolImg symbol={b.pairA} />
        <SymbolImg symbol={b.pairB} />
        <span style={{ color: '#a5b4fc' }}>Pair</span>
        <span>·</span>
        <span>{b.pairA}+{b.pairB}</span>
      </span>
    )
  }
  if (b.kind === 'RANGE' && b.range) {
    const icon = b.range === 'LOW'
      ? <ArrowDown size={14} style={{ color: '#60a5fa' }} />
      : b.range === 'HIGH'
        ? <ArrowUp size={14} style={{ color: '#f87171' }} />
        : <ArrowUpDown size={14} style={{ color: '#a78bfa' }} />
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: '#e9d5ff' }}>
        {icon}
        <span style={{ color: '#a5b4fc' }}>Range</span>
        <span>·</span>
        <span>{b.range}</span>
      </span>
    )
  }
  return <span className="text-xs">{b.kind}</span>
}

function BetCard({ b, rowNum }: { b: Bet; rowNum: number }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>#{rowNum}</span>
            <div className="text-sm font-semibold" style={{ color: '#e9d5ff' }}>
              {b.user.name ? `${b.user.name} · ` : ''}{b.user.tel}
            </div>
          </div>
          <div className="mt-0.5 text-xs" style={{ color: '#818cf8' }}>{new Date(b.createdAt).toLocaleString()}</div>
        </div>
        <ResultPill result={b.result} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: '#a5b4fc' }}>
        <BetDescription b={b} />
        {b.round && (
          <span className="flex items-center gap-1">
            <span>{b.round.mode} · {b.round.status}</span>
            {b.round.dice.map((d, i) => <SymbolImg key={i} symbol={d} size={14} />)}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>STAKE</div>
          <div className="font-semibold" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}</div>
        </div>
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>PAYOUT</div>
          <div className="font-semibold" style={{ color: b.payout && b.payout > 0 ? '#4ade80' : '#a5b4fc' }}>
            {b.payout != null ? b.payout.toLocaleString() : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResultPill({ result }: { result: string | null }) {
  if (!result) return <span className="text-[10px]" style={{ color: '#818cf8' }}>—</span>
  const isWin = result === 'WIN'
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold "
      style={{
        background: isWin ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
        color: isWin ? '#4ade80' : '#f87171',
      }}
    >
      {result}
    </span>
  )
}
