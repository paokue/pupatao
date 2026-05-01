import { Link, useLoaderData } from 'react-router'
import { Banknote, Dices, Radio, Users } from 'lucide-react'
import type { Route } from './+types/admin._index'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [
    customers,
    activeCustomers,
    pendingDeposits,
    pendingWithdraws,
    depositSumPending,
    bets24h,
    liveRounds,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.transaction.count({ where: { type: 'DEPOSIT', status: 'PENDING' } }),
    prisma.transaction.count({ where: { type: 'WITHDRAW', status: 'PENDING' } }),
    prisma.transaction.aggregate({
      where: { type: 'DEPOSIT', status: 'PENDING' },
      _sum: { amount: true },
    }),
    prisma.bet.count({ where: { createdAt: { gte: since24h } } }),
    prisma.gameRound.count({ where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } } }),
  ])

  return {
    customers,
    activeCustomers,
    pendingDeposits,
    pendingWithdraws,
    depositSumPending: depositSumPending._sum.amount ?? 0,
    bets24h,
    liveRounds,
  }
}

export default function AdminDashboard() {
  const d = useLoaderData<typeof loader>()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Customers"
          value={`${d.activeCustomers}/${d.customers}`}
          hint="active / total"
          to="/admin/customers"
          Icon={Users}
        />
        <StatCard
          label="Pending deposits"
          value={d.pendingDeposits.toString()}
          hint={`${d.depositSumPending.toLocaleString()} ₭ awaiting`}
          to="/admin/transactions"
          Icon={Banknote}
          accent={d.pendingDeposits > 0 ? '#facc15' : undefined}
        />
        <StatCard
          label="Pending withdraws"
          value={d.pendingWithdraws.toString()}
          hint="awaiting review"
          to="/admin/transactions?tab=withdraw"
          Icon={Banknote}
        />
        <StatCard
          label="Bets (24h)"
          value={d.bets24h.toLocaleString()}
          hint="all modes"
          to="/admin/play-history"
          Icon={Dices}
        />
        <StatCard
          label="Live rounds"
          value={d.liveRounds.toString()}
          hint="open or awaiting result"
          to="/admin/live"
          Icon={Radio}
          accent={d.liveRounds > 0 ? '#4ade80' : undefined}
        />
      </div>

      <div
        className="rounded-xl p-4 text-xs"
        style={{ background: '#0f172a', color: '#a5b4fc', border: '1px solid #1e1b4b' }}
      >
        Use the sidebar to manage customers, review deposit slips and withdrawals,
        inspect play history, and host LIVE rounds.
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  to,
  Icon,
  accent,
}: {
  label: string
  value: string
  hint: string
  to: string
  Icon: typeof Users
  accent?: string
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl p-4 transition-opacity hover:opacity-90"
      style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: `1px solid ${accent ?? '#4338ca'}` }}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold " style={{ color: '#a5b4fc' }}>
        <Icon size={12} />
        {label.toUpperCase()}
      </div>
      <div className="text-2xl font-bold" style={{ color: accent ?? '#fde68a' }}>{value}</div>
      <div className="mt-0.5 text-[10px]" style={{ color: '#818cf8' }}>{hint}</div>
    </Link>
  )
}
