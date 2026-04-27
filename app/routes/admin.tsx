import { useEffect, useState } from 'react'
import { Form, NavLink, Outlet, useLoaderData, useRevalidator } from 'react-router'
import { Banknote, Dices, LayoutDashboard, LogOut, Radio, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { Route } from './+types/admin'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import type {
  BetPlacedPayload,
  CustomerRegisteredPayload,
  RoundResolvedPayload,
  TxCreatedPayload,
  TxResolvedPayload,
} from '~/lib/pusher-channels'

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request)

  // Pending TX badge: deposits + withdraws awaiting approval.
  // Pending bets badge: bets attached to the currently-open LIVE round (BETTING phase only).
  const [pendingTx, openLiveRound] = await Promise.all([
    prisma.transaction.count({
      where: { type: { in: ['DEPOSIT', 'WITHDRAW'] }, status: 'PENDING' },
    }),
    prisma.gameRound.findFirst({
      where: { mode: 'LIVE', status: 'BETTING' },
      select: { id: true, _count: { select: { bets: true } } },
    }),
  ])

  return {
    admin: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    },
    counts: {
      pendingTx,
      pendingBets: openLiveRound?._count.bets ?? 0,
      openLiveRoundId: openLiveRound?.id ?? null,
    },
  }
}

type NavItem = {
  to: string
  end?: boolean
  label: string
  mobileLabel?: string
  Icon: typeof LayoutDashboard
  badgeKey?: 'pendingTx' | 'pendingBets'
}

const NAV: NavItem[] = [
  { to: '/admin', end: true, label: 'Dashboard', mobileLabel: 'Home', Icon: LayoutDashboard },
  { to: '/admin/customers', label: 'Customers', Icon: Users },
  { to: '/admin/transactions', label: 'Transactions', Icon: Banknote, badgeKey: 'pendingTx' },
  { to: '/admin/play-history', label: 'Play History', mobileLabel: 'Plays', Icon: Dices, badgeKey: 'pendingBets' },
  { to: '/admin/live', label: 'Live Play', mobileLabel: 'Live', Icon: Radio },
]

export default function AdminLayout() {
  const { admin, counts } = useLoaderData<typeof loader>()
  const fullName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email
  const revalidator = useRevalidator()

  // Local mutable copies seeded from the loader. Realtime events bump them
  // immediately; whenever the loader re-runs (action settle, navigation), we
  // reset back to the authoritative DB count so we don't drift over time.
  const [pendingTx, setPendingTx] = useState(counts.pendingTx)
  const [pendingBets, setPendingBets] = useState(counts.pendingBets)
  const [openLiveRoundId, setOpenLiveRoundId] = useState(counts.openLiveRoundId)

  useEffect(() => { setPendingTx(counts.pendingTx) }, [counts.pendingTx])
  useEffect(() => { setPendingBets(counts.pendingBets) }, [counts.pendingBets])
  useEffect(() => { setOpenLiveRoundId(counts.openLiveRoundId) }, [counts.openLiveRoundId])

  usePusherEvent<TxCreatedPayload>(ADMIN_CHANNEL, 'transaction:created', tx => {
    if (tx.type !== 'DEPOSIT' && tx.type !== 'WITHDRAW') return
    setPendingTx(n => n + 1)
  })

  usePusherEvent<TxResolvedPayload>(ADMIN_CHANNEL, 'transaction:resolved', () => {
    setPendingTx(n => Math.max(0, n - 1))
  })

  usePusherEvent<BetPlacedPayload>(ADMIN_CHANNEL, 'bet:placed', bet => {
    if (bet.mode !== 'LIVE') return
    setPendingBets(n => n + 1)
    // First bet of a new round we didn't know about yet — record the round id
    // so a `round:resolved` for *some other* round doesn't clobber our count.
    if (!openLiveRoundId) setOpenLiveRoundId(bet.roundId)
  })

  usePusherEvent<RoundResolvedPayload>(ADMIN_CHANNEL, 'round:resolved', round => {
    if (round.mode !== 'LIVE') return
    if (openLiveRoundId && round.roundId !== openLiveRoundId) return
    setPendingBets(0)
    setOpenLiveRoundId(null)
    // Round just ended → refetch loader so the dashboard reflects the new state.
    revalidator.revalidate()
  })

  usePusherEvent<CustomerRegisteredPayload>(ADMIN_CHANNEL, 'customer:registered', payload => {
    toast.success('New customer registered', { description: payload.tel })
    revalidator.revalidate()
  })

  const counters = { pendingTx, pendingBets }

  return (
    <div
      className="min-h-screen font-sans"
      style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 60%, #0f172a 100%)' }}
    >
      <header style={{ background: '#0f172a', borderBottom: '1px solid #4338ca' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: '#a5b4fc' }} />
            <span className="text-sm font-bold tracking-widest" style={{ color: '#fde68a' }}>
              PUPATAO · ADMIN
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col text-right sm:flex">
              <span className="text-xs font-semibold" style={{ color: '#e9d5ff' }}>{fullName}</span>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>{admin.role}</span>
            </div>
            <Form method="post" action="/admin/logout">
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
                style={{ background: '#1e1b4b', color: '#e9d5ff', border: '1px solid #4338ca' }}
              >
                <LogOut size={12} />
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        {/* Sidebar — vertical on md+, hidden on mobile (replaced by fixed bottom bar) */}
        <aside className="hidden md:block md:w-56 md:shrink-0">
          <nav
            className="flex flex-col gap-1 rounded-xl p-2"
            style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
          >
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => [
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'border' : 'hover:opacity-80',
                ].join(' ')}
                style={({ isActive }) => ({
                  background: isActive ? '#1e1b4b' : 'transparent',
                  color: isActive ? '#fde68a' : '#a5b4fc',
                  borderColor: isActive ? '#4338ca' : 'transparent',
                })}
              >
                <item.Icon size={14} />
                <span className="flex-1">{item.label}</span>
                {item.badgeKey && counters[item.badgeKey] > 0 && (
                  <Badge n={counters[item.badgeKey]} />
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* pb-24 on mobile leaves room for the fixed bottom bar */}
        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom bar — icon + label, equal-width buckets */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex md:hidden"
        style={{
          background: '#0f172a',
          borderTop: '1px solid #4338ca',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold tracking-wide"
            style={({ isActive }) => ({
              color: isActive ? '#fde68a' : '#a5b4fc',
              background: isActive ? '#1e1b4b' : 'transparent',
            })}
          >
            <item.Icon size={18} />
            <span>{item.mobileLabel ?? item.label}</span>
            {item.badgeKey && counters[item.badgeKey] > 0 && (
              <span className="absolute right-1/4 top-1">
                <Badge n={counters[item.badgeKey]} />
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span
      className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none"
      style={{
        background: '#dc2626',
        color: '#fff',
        height: 18,
        boxShadow: '0 0 6px rgba(220,38,38,0.6)',
      }}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
