import { useEffect, useState } from 'react'
import { Form, Link, useFetcher, useLoaderData, useNavigation, useOutletContext } from 'react-router'
import { Banknote, Dices, Moon, Radio, Users } from 'lucide-react'
import type { Route } from './+types/admin._index'
import { requireAdmin } from '~/lib/admin-auth.server'
import type { AdminOutletContext } from './admin'
import { prisma } from '~/lib/prisma.server'
import { getSleepMode, setSleepMode } from '~/lib/system-settings.server'
import { useT } from '~/lib/use-t'

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
    sleepMode,
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
    getSleepMode(),
  ])

  return {
    customers,
    activeCustomers,
    pendingDeposits,
    pendingWithdraws,
    depositSumPending: depositSumPending._sum.amount ?? 0,
    bets24h,
    liveRounds,
    sleepMode,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')

  if (op === 'toggleSleepMode') {
    // Sleep mode is a nuclear option — SUPERADMIN only, even via direct POST
    if (admin.role !== 'SUPERADMIN') return { error: 'admin.dashboard.errInsufficientPermissions' as const }
    const current = await getSleepMode()
    await setSleepMode(!current, admin.id)
    return { ok: true, sleepMode: !current }
  }

  return { error: 'admin.dashboard.errUnknownOp' as const }
}

export default function AdminDashboard() {
  const t = useT()
  const d = useLoaderData<typeof loader>()
  const { adminRole } = useOutletContext<AdminOutletContext>()
  const isSuperAdmin = adminRole === 'SUPERADMIN'
  const navigation = useNavigation()
  const loading = navigation.state !== 'idle'
  const [showConfirm, setShowConfirm] = useState(false)
  const sleepFetcher = useFetcher<{ ok?: boolean; sleepMode?: boolean }>()

  // Close the confirm modal once the fetcher response lands
  useEffect(() => {
    if (sleepFetcher.state === 'idle' && sleepFetcher.data?.ok) {
      setShowConfirm(false)
    }
  }, [sleepFetcher.state, sleepFetcher.data])


  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('admin.dashboard.title')}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('admin.dashboard.statCustomers')} value={`${d.activeCustomers}/${d.customers}`}
          hint={t('admin.dashboard.statCustomersHint')} to="/admin/customers" Icon={Users} />
        <StatCard label={t('admin.dashboard.statPendingDeposits')} value={d.pendingDeposits.toString()}
          hint={t('admin.dashboard.statPendingDepositsHint', { amount: d.depositSumPending.toLocaleString() })}
          to="/admin/transactions" Icon={Banknote}
          accent={d.pendingDeposits > 0 ? '#facc15' : undefined} />
        <StatCard label={t('admin.dashboard.statPendingWithdraws')} value={d.pendingWithdraws.toString()}
          hint={t('admin.dashboard.statPendingWithdrawsHint')} to="/admin/transactions?tab=withdraw" Icon={Banknote} />
        <StatCard label={t('admin.dashboard.statBets24h')} value={d.bets24h.toLocaleString()}
          hint={t('admin.dashboard.statBets24hHint')} to="/admin/play-history" Icon={Dices} />
        <StatCard label={t('admin.dashboard.statLiveRounds')} value={d.liveRounds.toString()}
          hint={t('admin.dashboard.statLiveRoundsHint')} to="/admin/live" Icon={Radio}
          accent={d.liveRounds > 0 ? '#4ade80' : undefined} />
      </div>

      {/* ── Sleep Mode — SUPERADMIN only ── */}
      {isSuperAdmin && <div
        className="rounded-xl p-4"
        style={{
          background: d.sleepMode ? 'rgba(220,38,38,0.12)' : 'rgba(15,23,42,1)',
          border: `1px solid ${d.sleepMode ? '#ef4444' : '#1e1b4b'}`,
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Moon size={20} style={{ color: d.sleepMode ? '#f87171' : '#818cf8', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: d.sleepMode ? '#f87171' : '#fde68a' }}>
                  {t('admin.dashboard.sleepMode')}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    background: d.sleepMode ? 'rgba(220,38,38,0.3)' : 'rgba(22,163,74,0.2)',
                    color: d.sleepMode ? '#fca5a5' : '#4ade80',
                    border: `1px solid ${d.sleepMode ? '#ef4444' : '#16a34a'}`,
                  }}
                >
                  {d.sleepMode ? t('admin.dashboard.sleepModeOn') : t('admin.dashboard.sleepModeOff')}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: '#818cf8' }}>
                {d.sleepMode
                  ? t('admin.dashboard.sleepModeDescOn')
                  : t('admin.dashboard.sleepModeDescOff')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={loading}
            className="shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-opacity disabled:opacity-50"
            style={{
              background: d.sleepMode
                ? 'linear-gradient(135deg,#16a34a,#14532d)'
                : 'linear-gradient(135deg,#dc2626,#7f1d1d)',
              color: '#fff',
              border: `2px solid ${d.sleepMode ? '#4ade80' : '#fca5a5'}`,
            }}
          >
            {d.sleepMode ? t('admin.dashboard.disableSleepMode') : t('admin.dashboard.enableSleepMode')}
          </button>
        </div>
      </div>}

      <div
        className="rounded-xl p-4 text-xs"
        style={{ background: '#0f172a', color: '#a5b4fc', border: '1px solid #1e1b4b' }}
      >
        {t('admin.dashboard.sidebarHint')}
      </div>

      {/* ── Confirmation modal — SUPERADMIN only ── */}
      {isSuperAdmin && showConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.8)' }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#1e0040', border: `2px solid ${d.sleepMode ? '#16a34a' : '#dc2626'}` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2">
              <Moon size={20} style={{ color: d.sleepMode ? '#4ade80' : '#f87171' }} />
              <h2 className="text-base font-bold" style={{ color: d.sleepMode ? '#4ade80' : '#f87171' }}>
                {d.sleepMode ? t('admin.dashboard.confirmDisableTitle') : t('admin.dashboard.confirmEnableTitle')}
              </h2>
            </div>

            <p className="mt-3 text-sm" style={{ color: '#e9d5ff' }}>
              {d.sleepMode ? (
                <>
                  {t('admin.dashboard.confirmDisableBody')} <strong>{t('admin.dashboard.confirmDisableBodyStrong')}</strong> {t('admin.dashboard.confirmDisableBodyEnd')}
                </>
              ) : (
                <>
                  <strong className="text-red-400">{t('admin.dashboard.confirmEnableBodyStrongRed')}</strong> {t('admin.dashboard.confirmEnableBodyMid')} <strong>{t('admin.dashboard.confirmEnableBodyStrongZero')}</strong> {t('admin.dashboard.confirmEnableBodyEnd')}
                </>
              )}
            </p>

            <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: '#a78bfa' }}>
              {t('admin.dashboard.takesEffectNote')}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={{ background: '#2d1b4e', color: '#a78bfa', border: '1px solid #4c1d95' }}
              >
                {t('admin.dashboard.cancel')}
              </button>
              <sleepFetcher.Form method="post" className="flex-1">
                <input type="hidden" name="op" value="toggleSleepMode" />
                <button
                  type="submit"
                  disabled={sleepFetcher.state !== 'idle'}
                  className="w-full rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                  style={{
                    background: d.sleepMode
                      ? 'linear-gradient(135deg,#16a34a,#14532d)'
                      : 'linear-gradient(135deg,#dc2626,#7f1d1d)',
                    color: '#fff',
                    border: `1px solid ${d.sleepMode ? '#4ade80' : '#fca5a5'}`,
                  }}
                >
                  {sleepFetcher.state !== 'idle' ? t('admin.dashboard.savingEllipsis') : d.sleepMode ? t('admin.dashboard.yesDisable') : t('admin.dashboard.yesEnable')}
                </button>
              </sleepFetcher.Form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, hint, to, Icon, accent,
}: {
  label: string; value: string; hint: string; to: string
  Icon: typeof Users; accent?: string
}) {
  return (
    <Link to={to}
      className="block rounded-xl p-4 transition-opacity hover:opacity-90"
      style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: `1px solid ${accent ?? '#4338ca'}` }}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold" style={{ color: '#a5b4fc' }}>
        <Icon size={12} />
        {label.toUpperCase()}
      </div>
      <div className="text-2xl font-bold" style={{ color: accent ?? '#fde68a' }}>{value}</div>
      <div className="mt-0.5 text-[10px]" style={{ color: '#818cf8' }}>{hint}</div>
    </Link>
  )
}
