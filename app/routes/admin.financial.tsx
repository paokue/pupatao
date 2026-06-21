import { Form, useLoaderData, useNavigation } from 'react-router'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, BarChart2, Clock, Loader, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { requireRole } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { useT } from '~/lib/use-t'
import type { StringKey } from '~/lib/i18n'

type Period = 'today' | 'week' | 'month' | 'all' | 'custom'

// Vientiane is UTC+7. All DB queries need UTC dates, but the admin thinks in
// local time, so we convert every boundary to UTC before querying.
const VI_OFFSET_MS = 7 * 60 * 60 * 1000

// Shift a UTC Date forward by 7 h so its UTC fields read as Vientiane local fields.
function toVI(utc: Date) {
  return new Date(utc.getTime() + VI_OFFSET_MS)
}

// Build a UTC Date from Vientiane local year/month(0-based)/day/hour/min.
function viUTC(y: number, m: number, d: number, h: number, min: number, s = 0, ms = 0) {
  // Date.UTC handles negative days / overflow months automatically.
  return new Date(Date.UTC(y, m, d, h - 7, min, s, ms))
}

// "YYYY-MM-DDTHH:mm" in Vientiane local time — used as datetime-local input values.
function toVIInputDatetime(utc: Date) {
  return toVI(utc).toISOString().slice(0, 16)
}

function getPeriodRange(period: Period, from: string, to: string): { gte: Date; lte: Date } {
  const nowUTC = new Date()
  const vi = toVI(nowUTC)  // local date components via UTC fields of shifted date
  const ly = vi.getUTCFullYear()
  const lm = vi.getUTCMonth()   // 0-based
  const ld = vi.getUTCDate()
  const ldow = vi.getUTCDay()   // 0=Sun … 6=Sat

  if (period === 'today') {
    return { gte: viUTC(ly, lm, ld, 0, 1), lte: viUTC(ly, lm, ld, 23, 59, 59, 999) }
  }
  if (period === 'week') {
    // ISO week: Monday=start, Sunday=end
    const daysFromMon = (ldow + 6) % 7   // Mon→0, Tue→1 … Sun→6
    const monDay = ld - daysFromMon
    const sunDay = monDay + 6
    return { gte: viUTC(ly, lm, monDay, 0, 1), lte: viUTC(ly, lm, sunDay, 23, 59, 59, 999) }
  }
  if (period === 'month') {
    // Last day of month: day 0 of the next month
    const lastDay = new Date(Date.UTC(ly, lm + 1, 0)).getUTCDate()
    return { gte: viUTC(ly, lm, 1, 0, 1), lte: viUTC(ly, lm, lastDay, 23, 59, 59, 999) }
  }
  if (period === 'all') {
    return { gte: new Date(0), lte: new Date(nowUTC.getTime() + 1000) }
  }
  // custom — datetime-local values arrive as "YYYY-MM-DDTHH:mm" without timezone.
  // Node.js parses them as UTC, but the admin typed Vientiane local time, so
  // subtract 7 h to get the correct UTC equivalent.
  const start = from
    ? new Date(new Date(from).getTime() - VI_OFFSET_MS)
    : viUTC(ly, lm, ld - 30, 0, 1)
  const end = to
    ? new Date(new Date(to).getTime() - VI_OFFSET_MS)
    : nowUTC
  return { gte: start, lte: end }
}

export async function loader({ request }: { request: Request }) {
  await requireRole(request, ['SUPERADMIN'])
  const url = new URL(request.url)
  const period = (url.searchParams.get('period') ?? 'month') as Period
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  const range = getPeriodRange(period, from, to)

  const [
    periodDeposits, periodWithdrawals, periodNewUsers, periodRawTx,
    periodPromo, periodReferral,
    allDeposits, allWithdrawals, realWalletTotal,
    pendingDep, pendingWith,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: 'DEPOSIT', status: 'COMPLETED', createdAt: { gte: range.gte, lte: range.lte } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: { type: 'WITHDRAW', status: 'COMPLETED', createdAt: { gte: range.gte, lte: range.lte } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    prisma.user.count({ where: { createdAt: { gte: range.gte, lte: range.lte } } }),
    // Fetch raw deposit/withdraw for daily breakdown (amount + date only)
    prisma.transaction.findMany({
      where: {
        type: { in: ['DEPOSIT', 'WITHDRAW'] },
        status: 'COMPLETED',
        createdAt: { gte: range.gte, lte: range.lte },
      },
      select: { type: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.transaction.aggregate({
      where: { type: 'PROMO_BONUS', status: 'COMPLETED', createdAt: { gte: range.gte, lte: range.lte } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: { type: 'REFERRAL_BONUS', status: 'COMPLETED', createdAt: { gte: range.gte, lte: range.lte } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    // All-time — for bank reconciliation
    prisma.transaction.aggregate({ where: { type: 'DEPOSIT', status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: 'WITHDRAW', status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.wallet.aggregate({ where: { type: 'REAL' }, _sum: { balance: true } }),
    // Pending (always current)
    prisma.transaction.aggregate({ where: { type: 'DEPOSIT', status: 'PENDING' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.transaction.aggregate({ where: { type: 'WITHDRAW', status: 'PENDING' }, _sum: { amount: true }, _count: { _all: true } }),
  ])

  // Build daily rows — bucket by Vientiane local date (UTC+7) not UTC date.
  const byDate = new Map<string, { depCount: number; depAmount: number; withCount: number; withAmount: number }>()
  for (const tx of periodRawTx) {
    const key = toVI(tx.createdAt).toISOString().slice(0, 10)
    const cur = byDate.get(key) ?? { depCount: 0, depAmount: 0, withCount: 0, withAmount: 0 }
    if (tx.type === 'DEPOSIT') { cur.depCount++; cur.depAmount += tx.amount }
    else { cur.withCount++; cur.withAmount += tx.amount }
    byDate.set(key, cur)
  }
  const dailyRows = Array.from(byDate.entries())
    .map(([date, d]) => ({
      date,
      depCount: d.depCount, depAmount: d.depAmount,
      withCount: d.withCount, withAmount: d.withAmount,
      net: d.depAmount - d.withAmount,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  // Reconciliation (all-time, REAL wallets only — PROMO excluded per config)
  const allIn = allDeposits._sum.amount ?? 0
  const allOut = allWithdrawals._sum.amount ?? 0
  const bankPosition = allIn - allOut            // what should be in the bank
  const customerLiability = realWalletTotal._sum.balance ?? 0  // what you owe customers
  const houseProfit = bankPosition - customerLiability

  return {
    period, from, to,
    // rangeStart/rangeEnd are in Vientiane local time for display & input pre-fill.
    rangeStart: toVIInputDatetime(range.gte),
    rangeEnd: toVIInputDatetime(range.lte),
    // Period
    periodIn: periodDeposits._sum.amount ?? 0,
    periodInCount: periodDeposits._count._all,
    periodOut: periodWithdrawals._sum.amount ?? 0,
    periodOutCount: periodWithdrawals._count._all,
    periodNet: (periodDeposits._sum.amount ?? 0) - (periodWithdrawals._sum.amount ?? 0),
    periodNewUsers,
    periodPromoAmount: periodPromo._sum.amount ?? 0,
    periodPromoCount: periodPromo._count._all,
    periodReferralAmount: periodReferral._sum.amount ?? 0,
    periodReferralCount: periodReferral._count._all,
    dailyRows,
    // Reconciliation
    bankPosition, customerLiability, houseProfit,
    pendingDepAmount: pendingDep._sum.amount ?? 0,
    pendingDepCount: pendingDep._count._all,
    pendingWithAmount: pendingWith._sum.amount ?? 0,
    pendingWithCount: pendingWith._count._all,
  }
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M`
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(2))}K`
  return n.toLocaleString()
}

// For daily-row dates (YYYY-MM-DD) — force local midnight to avoid UTC off-by-one.
function fmtDate(iso: string) {
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

// For range display headers — splits at 'T' and formats the date part only
// via local-midnight parsing (no UTC→local conversion), then appends the raw
// time string so the display matches exactly what the admin typed.
function fmtDatetime(iso: string) {
  const [datePart, timePart] = iso.split('T')
  const dateLabel = fmtDate(datePart)
  return timePart ? `${dateLabel}, ${timePart}` : dateLabel
}

const PERIOD_TABS: { key: Period; labelKey: StringKey }[] = [
  { key: 'today', labelKey: 'admin.financial.period.today' },
  { key: 'week', labelKey: 'admin.financial.period.week' },
  { key: 'month', labelKey: 'admin.financial.period.month' },
  { key: 'all', labelKey: 'admin.financial.period.all' },
  { key: 'custom', labelKey: 'admin.financial.period.custom' },
]

export default function AdminFinancial() {
  const t = useT()
  const data = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const loading = navigation.state !== 'idle'

  const profitPositive = data.houseProfit >= 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <BarChart2 size={18} style={{ color: '#fde68a' }} />
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('admin.financial.title')}</h1>
        {loading && <Loader size={14} className="animate-spin ml-auto" style={{ color: '#a5b4fc' }} />}
      </div>

      {/* ── Period filter ─────────────────────────────────── */}
      <Form method="get" className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg text-xs font-bold" style={{ border: '1px solid #4338ca' }}>
          {PERIOD_TABS.map(tab => (
            <button
              key={tab.key}
              type="submit"
              name="period"
              value={tab.key}
              className="px-3 py-1.5 transition-colors"
              style={{
                background: data.period === tab.key ? '#4338ca' : 'transparent',
                color: data.period === tab.key ? '#fff' : '#a5b4fc',
              }}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        {data.period === 'custom' && (
          <>
            <input
              type="datetime-local"
              name="from"
              defaultValue={data.from || data.rangeStart}
              className="rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: '#0f172a', color: '#e9d5ff', border: '1px solid #4338ca' }}
            />
            <span className="text-xs" style={{ color: '#64748b' }}>→</span>
            <input
              type="datetime-local"
              name="to"
              defaultValue={data.to || data.rangeEnd}
              className="rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: '#0f172a', color: '#e9d5ff', border: '1px solid #4338ca' }}
            />
            <button
              type="submit"
              name="period"
              value="custom"
              className="rounded-md px-3 py-1.5 text-xs font-bold"
              style={{ background: '#4338ca', color: '#fff' }}
            >
              {t('admin.financial.apply')}
            </button>
          </>
        )}
        {data.period !== 'all' && (
          <span className="ml-auto text-[11px]" style={{ color: '#64748b' }}>
            {fmtDatetime(data.rangeStart)} – {fmtDatetime(data.rangeEnd)}
          </span>
        )}
      </Form>

      {/* ── Bank Reconciliation (all-time) ────────────────── */}
      <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: '1.5px solid #4338ca' }}>
        <div className="mb-3 text-[11px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>
          {t('admin.financial.recon.title')}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ReconCard
            label={t('admin.financial.recon.bankPosition')}
            sublabel={t('admin.financial.recon.bankPositionSub')}
            value={data.bankPosition}
            color="#fde68a"
          />
          <ReconCard
            label={t('admin.financial.recon.customerLiability')}
            sublabel={t('admin.financial.recon.customerLiabilitySub')}
            value={data.customerLiability}
            color="#a5b4fc"
          />
          <div
            className="col-span-2 flex flex-col justify-center rounded-xl p-3"
            style={{ background: profitPositive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${profitPositive ? '#4ade80' : '#f87171'}` }}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: profitPositive ? '#4ade80' : '#f87171' }}>
              {profitPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {profitPositive ? t('admin.financial.recon.estimatedProfit') : t('admin.financial.recon.estimatedDeficit')}
            </div>
            <div className="mt-1 text-2xl font-bold md:text-3xl" style={{ color: profitPositive ? '#4ade80' : '#f87171' }}>
              {fmt(Math.abs(data.houseProfit))}
            </div>
            <div className="mt-1 text-[10px]" style={{ color: '#64748b' }}>
              {t('admin.financial.recon.profitFormula')}
            </div>
          </div>
        </div>

        {/* Pending alerts */}
        {(data.pendingDepCount > 0 || data.pendingWithCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.pendingDepCount > 0 && (
              <PendingChip
                icon={<ArrowDownCircle size={11} />}
                label={t('admin.financial.pending.deposits', { count: data.pendingDepCount, s: data.pendingDepCount === 1 ? '' : 's' })}
                amount={data.pendingDepAmount}
                color="#4ade80"
                note={t('admin.financial.pending.depositsNote')}
              />
            )}
            {data.pendingWithCount > 0 && (
              <PendingChip
                icon={<ArrowUpCircle size={11} />}
                label={t('admin.financial.pending.withdrawals', { count: data.pendingWithCount, s: data.pendingWithCount === 1 ? '' : 's' })}
                amount={data.pendingWithAmount}
                color="#f87171"
                note={t('admin.financial.pending.withdrawalsNote')}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Period metrics ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          icon={<ArrowDownCircle size={14} />}
          label={t('admin.financial.metric.depositsIn')}
          value={data.periodIn}
          count={data.periodInCount}
          color="#4ade80"
        />
        <MetricCard
          icon={<ArrowUpCircle size={14} />}
          label={t('admin.financial.metric.withdrawalsOut')}
          value={data.periodOut}
          count={data.periodOutCount}
          color="#f87171"
        />
        <MetricCard
          icon={data.periodNet >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          label={t('admin.financial.metric.netCashFlow')}
          value={data.periodNet}
          color={data.periodNet >= 0 ? '#fde68a' : '#f87171'}
          signed
        />
        <MetricCard
          icon={<Users size={14} />}
          label={t('admin.financial.metric.newCustomers')}
          value={data.periodNewUsers}
          color="#a5b4fc"
          isCount
        />
      </div>

      {(data.periodPromoAmount > 0 || data.periodReferralAmount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {data.periodPromoAmount > 0 && (
            <MetricCard
              icon={<Clock size={14} />}
              label={t('admin.financial.metric.promoBonusGiven')}
              value={data.periodPromoAmount}
              count={data.periodPromoCount}
              color="#fcd34d"
            />
          )}
          {data.periodReferralAmount > 0 && (
            <MetricCard
              icon={<Clock size={14} />}
              label={t('admin.financial.metric.referralBonusGiven')}
              value={data.periodReferralAmount}
              count={data.periodReferralCount}
              color="#fcd34d"
            />
          )}
        </div>
      )}

      {/* ── Daily breakdown ───────────────────────────────── */}
      <div>
        <div className="mb-2 text-[10px] font-bold tracking-wider" style={{ color: '#a5b4fc' }}>
          {t('admin.financial.daily.title')}
        </div>
        <div className="overflow-x-auto rounded-xl" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <table className="w-full min-w-[540px] text-left text-xs">
            <thead style={{ color: '#a5b4fc' }}>
              <tr className="text-[10px] font-bold" style={{ background: '#1e1b4b' }}>
                <th className="px-4 py-2.5">{t('admin.financial.daily.date')}</th>
                <th className="px-4 py-2.5 text-right">{t('admin.financial.metric.depositsIn')}</th>
                <th className="px-4 py-2.5 text-right">{t('admin.financial.metric.withdrawalsOut')}</th>
                <th className="px-4 py-2.5 text-right">{t('admin.financial.daily.net')}</th>
              </tr>
            </thead>
            <tbody>
              {data.dailyRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center" style={{ color: '#64748b' }}>
                    {t('admin.financial.daily.empty')}
                  </td>
                </tr>
              )}
              {data.dailyRows.map(row => (
                <tr key={row.date} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: '#a5b4fc' }}>
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.depAmount > 0 ? (
                      <span style={{ color: '#4ade80' }}>
                        +{fmt(row.depAmount)}{' '}
                        <span className="text-[10px]" style={{ color: '#64748b' }}>×{row.depCount}</span>
                      </span>
                    ) : <span style={{ color: '#64748b' }}>—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.withAmount > 0 ? (
                      <span style={{ color: '#f87171' }}>
                        −{fmt(row.withAmount)}{' '}
                        <span className="text-[10px]" style={{ color: '#64748b' }}>×{row.withCount}</span>
                      </span>
                    ) : <span style={{ color: '#64748b' }}>—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold">
                    <span style={{ color: row.net >= 0 ? '#fde68a' : '#f87171' }}>
                      {row.net >= 0 ? '+' : '−'}{fmt(Math.abs(row.net))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {data.dailyRows.length > 1 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid #4338ca', color: '#e9d5ff' }}>
                  <td className="px-4 py-2.5 text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.financial.daily.total')}</td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: '#4ade80' }}>
                    +{fmt(data.periodIn)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: '#f87171' }}>
                    −{fmt(data.periodOut)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: data.periodNet >= 0 ? '#fde68a' : '#f87171' }}>
                    {data.periodNet >= 0 ? '+' : '−'}{fmt(Math.abs(data.periodNet))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Glossary ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <GlossaryCard
          term={t('admin.financial.metric.netCashFlow')}
          color="#fde68a"
          formula={t('admin.financial.glossary.netCashFlow.formula')}
          explain={t('admin.financial.glossary.netCashFlow.explain')}
          example={t('admin.financial.glossary.netCashFlow.example', { periodIn: fmt(data.periodIn), periodOut: fmt(data.periodOut), periodNet: `${data.periodNet >= 0 ? '+' : ''}${fmt(data.periodNet)}` })}
        />
        <GlossaryCard
          term={t('admin.financial.recon.customerLiability')}
          color="#a5b4fc"
          formula={t('admin.financial.glossary.customerLiability.formula')}
          explain={t('admin.financial.glossary.customerLiability.explain')}
          example={t('admin.financial.glossary.customerLiability.example', { amount: fmt(data.customerLiability) })}
        />
        <GlossaryCard
          term={t('admin.financial.recon.bankPosition')}
          color="#fde68a"
          formula={t('admin.financial.glossary.bankPosition.formula')}
          explain={t('admin.financial.glossary.bankPosition.explain')}
          example={t('admin.financial.glossary.bankPosition.example', { amount: fmt(data.bankPosition) })}
        />
        <GlossaryCard
          term={data.houseProfit >= 0 ? t('admin.financial.glossary.houseProfit.term') : t('admin.financial.glossary.houseDeficit.term')}
          color={data.houseProfit >= 0 ? '#4ade80' : '#f87171'}
          formula={t('admin.financial.recon.profitFormula')}
          explain={
            data.houseProfit >= 0
              ? t('admin.financial.glossary.houseProfit.explainPositive')
              : t('admin.financial.glossary.houseProfit.explainNegative')
          }
          example={t('admin.financial.glossary.houseProfit.example', { bankPosition: fmt(data.bankPosition), customerLiability: fmt(data.customerLiability), houseProfit: `${data.houseProfit >= 0 ? '+' : ''}${fmt(data.houseProfit)}` })}
        />
      </div>

      {/* ── Verification guide ───────────────────────────── */}
      <div className="rounded-lg px-4 py-3 text-xs" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="mb-2 flex items-center gap-1.5 font-bold" style={{ color: '#a5b4fc' }}>
          <AlertTriangle size={11} />
          {t('admin.financial.verify.title')}
        </div>
        <ol className="list-decimal ml-4 space-y-1" style={{ color: '#94a3b8' }}>
          <li>{t('admin.financial.verify.step1')}</li>
          <li>{t('admin.financial.verify.step2', { amount: fmt(data.bankPosition) })}</li>
          <li>{t('admin.financial.verify.step3')}</li>
          <li>{t('admin.financial.verify.step4')}</li>
          <li>{t('admin.financial.verify.step5', { amount: fmt(data.pendingWithAmount) })}</li>
          <li>{t('admin.financial.verify.step6', { amount: fmt(data.pendingDepAmount) })}</li>
        </ol>
      </div>
    </div>
  )
}

function ReconCard({ label, sublabel, value, color }: { label: string; sublabel: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{label.toUpperCase()}</div>
      <div className="mt-1 text-xl font-bold md:text-2xl" style={{ color }}>{fmt(value)}</div>
      <div className="mt-0.5 text-[10px]" style={{ color: '#64748b' }}>{sublabel}</div>
    </div>
  )
}

function MetricCard({
  icon, label, value, count, color, signed, isCount,
}: {
  icon: React.ReactNode; label: string; value: number; count?: number; color: string; signed?: boolean; isCount?: boolean
}) {
  const t = useT()
  const display = isCount ? value.toLocaleString() : `${signed && value >= 0 ? '+' : signed && value < 0 ? '−' : ''}${fmt(Math.abs(value))}`
  return (
    <div className="rounded-xl p-3" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: '#a5b4fc' }}>
        <span style={{ color }}>{icon}</span>
        {label.toUpperCase()}
      </div>
      <div className="mt-1 text-xl font-bold" style={{ color }}>{display}</div>
      {count !== undefined && (
        <div className="mt-0.5 text-[10px]" style={{ color: '#64748b' }}>{t('admin.financial.metric.transactionCount', { count, s: count === 1 ? '' : 's' })}</div>
      )}
    </div>
  )
}

function PendingChip({
  icon, label, amount, color, note,
}: { icon: React.ReactNode; label: string; amount: number; color: string; note: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
      style={{ background: 'rgba(248,113,113,0.06)', border: `1px solid ${color}33` }}
    >
      <span className="mt-0.5" style={{ color }}>{icon}</span>
      <div>
        <div className="font-bold" style={{ color }}>{label} — {fmt(amount)}</div>
        <div style={{ color: '#64748b' }}>{note}</div>
      </div>
    </div>
  )
}

function GlossaryCard({
  term, color, formula, explain, example,
}: { term: string; color: string; formula: string; explain: string; example: string }) {
  const t = useT()
  return (
    <div className="rounded-lg px-4 py-3 text-xs" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold" style={{ color }}>{term}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#1e1b4b', color: '#a5b4fc' }}>
          {formula}
        </span>
      </div>
      <p className="mt-1.5" style={{ color: '#94a3b8' }}>{explain}</p>
      <p className="mt-1 text-[10px]" style={{ color: '#64748b' }}>{t('admin.financial.glossary.example.prefix')} {example}</p>
    </div>
  )
}
