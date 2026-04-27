import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router'
import type { Route } from './+types/admin.play-history'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL, type BetPlacedPayload, type RoundResolvedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'

const PAGE_SIZE = 30

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)

  const [total, bets] = await Promise.all([
    prisma.bet.count(),
    prisma.bet.findMany({
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
  const revalidator = useRevalidator()
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Play history</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{data.total.toLocaleString()} bets</span>
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
          {data.bets.map(b => (
            <BetCard key={b.id} b={b} />
          ))}
        </div>
      )}

      {/* Desktop: table */}
      {data.bets.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl md:block" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <table className="w-full text-left text-sm">
            <thead style={{ color: '#a5b4fc' }}>
              <tr className="text-[10px] font-bold tracking-widest" style={{ background: '#1e1b4b' }}>
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
              {data.bets.map(b => (
                <tr key={b.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: '#818cf8' }}>{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{b.user.name ? `${b.user.name} · ` : ''}{b.user.tel}</td>
                  <td className="px-3 py-2 text-xs">{describeBet(b)}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: '#a5b4fc' }}>
                    {b.round ? `${b.round.mode} · ${b.round.status}${b.round.dice.length ? ` · ${b.round.dice.join('/')}` : ''}` : '—'}
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
        <div className="flex items-center justify-center gap-2">
          {data.page > 1 && (
            <Link to={pageHref(data.page - 1)} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>← Prev</Link>
          )}
          <span className="text-xs" style={{ color: '#a5b4fc' }}>Page {data.page} / {totalPages}</span>
          {data.page < totalPages && (
            <Link to={pageHref(data.page + 1)} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>Next →</Link>
          )}
        </div>
      )}
    </div>
  )
}

type Bet = ReturnType<typeof useLoaderData<typeof loader>>['bets'][number]

function describeBet(b: Bet): string {
  if (b.kind === 'SYMBOL' && b.symbol) return `Symbol · ${b.symbol}`
  if (b.kind === 'RANGE' && b.range) return `Range · ${b.range}`
  if (b.kind === 'PAIR' && b.pairA && b.pairB) return `Pair · ${b.pairA}+${b.pairB}`
  return b.kind
}

function BetCard({ b }: { b: Bet }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: '#e9d5ff' }}>
            {b.user.name ? `${b.user.name} · ` : ''}{b.user.tel}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: '#818cf8' }}>{new Date(b.createdAt).toLocaleString()}</div>
        </div>
        <ResultPill result={b.result} />
      </div>
      <div className="mt-2 text-xs" style={{ color: '#a5b4fc' }}>
        {describeBet(b)}
        {b.round ? ` · ${b.round.mode}/${b.round.status}${b.round.dice.length ? ` · ${b.round.dice.join('/')}` : ''}` : ''}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>STAKE</div>
          <div className="font-semibold" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}</div>
        </div>
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>PAYOUT</div>
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
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
      style={{
        background: isWin ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
        color: isWin ? '#4ade80' : '#f87171',
      }}
    >
      {result}
    </span>
  )
}
