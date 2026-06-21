import { useEffect, useState } from 'react'
import { Form, NavLink, Outlet, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { BarChart2, Banknote, Dices, LayoutDashboard, Loader, LogOut, Radio, ShieldCheck, Trophy, Users, Wallet } from 'lucide-react'
import { Skeleton } from '~/components/ui/skeleton'
import { toast } from 'sonner'
import type { Route } from './+types/admin'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { useT, useLocale } from '~/lib/use-t'
import { LanguageSwitch } from '~/components/LanguageSwitch'
import type { StringKey, Locale } from '~/lib/i18n'
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

type AdminRole = 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'

// Exported so child routes can type the outlet context.
export type AdminOutletContext = { adminRole: AdminRole; locale: Locale }

type NavItem = {
  to: string
  end?: boolean
  labelKey: StringKey
  mobileLabelKey?: StringKey
  Icon: typeof LayoutDashboard
  badgeKey?: 'pendingTx' | 'pendingBets'
  // Roles that can see this item. Omit = visible to all.
  roles?: AdminRole[]
}

const NAV: NavItem[] = [
  { to: '/admin', end: true, labelKey: 'admin.shell.dashboard', mobileLabelKey: 'admin.shell.dashboardMobile', Icon: LayoutDashboard },
  { to: '/admin/customers', labelKey: 'admin.shell.customers', mobileLabelKey: 'admin.shell.customersMobile', Icon: Users },
  { to: '/admin/live', labelKey: 'admin.shell.livePlay', mobileLabelKey: 'admin.shell.livePlayMobile', Icon: Radio },
  { to: '/admin/wallet', labelKey: 'admin.shell.wallet', Icon: Wallet, roles: ['ADMIN', 'SUPERADMIN'] },
  { to: '/admin/transactions', labelKey: 'admin.shell.transactions', mobileLabelKey: 'admin.shell.transactionsMobile', Icon: Banknote, badgeKey: 'pendingTx', roles: ['ADMIN', 'SUPERADMIN'] },
  { to: '/admin/play-history', labelKey: 'admin.shell.playHistory', mobileLabelKey: 'admin.shell.playHistoryMobile', Icon: Dices, badgeKey: 'pendingBets', roles: ['ADMIN', 'SUPERADMIN'] },
  { to: '/admin/competition', labelKey: 'admin.shell.competition', mobileLabelKey: 'admin.shell.competitionMobile', Icon: Trophy, roles: ['ADMIN', 'SUPERADMIN'] },
  { to: '/admin/financial', labelKey: 'admin.shell.financial', mobileLabelKey: 'admin.shell.financialMobile', Icon: BarChart2, roles: ['SUPERADMIN'] },
]

export default function AdminLayout() {
  const t = useT()
  const locale = useLocale()
  const { admin, counts } = useLoaderData<typeof loader>()
  const fullName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email
  const visibleNav = NAV.filter(item => !item.roles || item.roles.includes(admin.role as AdminRole))
  const revalidator = useRevalidator()
  const navigation = useNavigation()
  const isNavigating = navigation.state === 'loading'
  const destPath = navigation.location?.pathname ?? ''
  const skelType = destPath === '/admin' || destPath === '/admin/'
    ? 'dashboard'
    : destPath.startsWith('/admin/live')
    ? 'live'
    : 'table'

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
    toast.success(t('admin.shell.newCustomerRegistered'), { description: payload.tel })
    revalidator.revalidate()
  })

  const counters = { pendingTx, pendingBets }

  return (
    <div
      className="min-h-screen font-sans"
      style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 60%, #0f172a 100%)' }}
    >
      {/* Top progress bar */}
      {isNavigating && (
        <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
          <div
            className="h-full w-full origin-left"
            style={{
              background: '#fde68a',
              animation: 'admin-progress 1.2s ease-in-out infinite',
            }}
          />
        </div>
      )}
      {/* Floating loading chip */}
      {isNavigating && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center pt-16">
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-2xl"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
          >
            <Loader size={14} className="animate-spin" />
            {t('admin.shell.loading')}
          </div>
        </div>
      )}
      <header style={{ background: '#0f172a', borderBottom: '1px solid #4338ca' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: '#a5b4fc' }} />
            <span className="text-sm font-bold " style={{ color: '#fde68a' }}>
              PUPATAO · ADMIN
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col text-right sm:flex">
              <span className="text-xs font-semibold" style={{ color: '#e9d5ff' }}>{fullName}</span>
              <span className="text-[10px] font-bold " style={{ color: '#a5b4fc' }}>{admin.role}</span>
            </div>
            <LanguageSwitch variant="pill" />
            <Form method="post" action="/admin/logout">
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
                style={{ background: '#1e1b4b', color: '#e9d5ff', border: '1px solid #4338ca' }}
              >
                <LogOut size={12} />
                {t('admin.shell.signOut')}
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
            {visibleNav.map(item => (
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
                <span className="flex-1">{t(item.labelKey)}</span>
                {item.badgeKey && counters[item.badgeKey] > 0 && (
                  <Badge n={counters[item.badgeKey]} />
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* pb-24 on mobile leaves room for the fixed bottom bar */}
        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          {isNavigating ? (
            skelType === 'dashboard' ? <DashboardSkeleton /> :
            skelType === 'live'      ? <LiveSkeleton />      :
                                       <TableSkeleton />
          ) : (
            <Outlet context={{ adminRole: admin.role as AdminRole, locale } satisfies AdminOutletContext} />
          )}
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
        {visibleNav.map(item => (
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
            <span>{t(item.mobileLabelKey ?? item.labelKey)}</span>
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

const SK = 'bg-white/10 animate-pulse'

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className={`h-7 w-36 ${SK}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
            <Skeleton className={`h-3 w-20 ${SK}`} />
            <Skeleton className={`h-7 w-12 ${SK}`} />
            <Skeleton className={`h-3 w-16 ${SK}`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[1, 2].map(i => (
          <div key={i} className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
            <Skeleton className={`mb-3 h-4 w-28 ${SK}`} />
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className={`mb-2 h-8 w-full rounded-lg ${SK}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function TableSkeleton() {
  const cols = [120, 90, 100, 80, 70, 60]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className={`h-7 w-36 ${SK}`} />
        <Skeleton className={`h-9 w-52 rounded-lg ${SK}`} />
      </div>
      {/* Tabs */}
      <div className="flex gap-2">
        {[80, 90, 100].map((w, i) => (
          <Skeleton key={i} className={`h-8 rounded-lg ${SK}`} style={{ width: w }} />
        ))}
      </div>
      {/* Table */}
      <div className="overflow-hidden rounded-xl" style={{ border: '1px solid #1e1b4b' }}>
        <div className="flex gap-3 px-4 py-3" style={{ background: '#0a0f1e', borderBottom: '1px solid #1e1b4b' }}>
          {cols.map((w, i) => <Skeleton key={i} className={`h-3 ${SK}`} style={{ width: w }} />)}
        </div>
        {Array.from({ length: 9 }).map((_, row) => (
          <div key={row} className="flex gap-3 px-4 py-3" style={{ background: row % 2 === 0 ? '#0f172a' : '#0a0f1e', borderBottom: '1px solid #1e1b4b' }}>
            {cols.map((w, i) => <Skeleton key={i} className={`h-3 rounded ${SK}`} style={{ width: w }} />)}
          </div>
        ))}
      </div>
      {/* Pagination row */}
      <div className="flex justify-end gap-2">
        {[60, 32, 32, 60].map((w, i) => (
          <Skeleton key={i} className={`h-8 rounded-lg ${SK}`} style={{ width: w }} />
        ))}
      </div>
    </div>
  )
}

function LiveSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className={`h-7 w-36 ${SK}`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Stream area */}
        <Skeleton className={`h-64 rounded-xl ${SK}`} />
        {/* Controls */}
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-10 rounded-xl ${SK}`} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="md:col-span-2 rounded-xl p-3" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <Skeleton className={`mb-3 h-4 w-20 ${SK}`} />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={`mb-2 h-8 w-full rounded-lg ${SK}`} />
          ))}
        </div>
        <div className="md:col-span-3 rounded-xl p-3" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <Skeleton className={`mb-3 h-4 w-24 ${SK}`} />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={`mb-2 h-8 w-full rounded-lg ${SK}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Inject the progress bar keyframe once into the document head
if (typeof document !== 'undefined') {
  const id = '__admin-progress-style'
  if (!document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent = `
      @keyframes admin-progress {
        0%   { transform: translateX(-100%); }
        50%  { transform: translateX(0%); }
        100% { transform: translateX(100%); }
      }
    `
    document.head.appendChild(s)
  }
}
