import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Form, useFetcher, useLoaderData, useNavigation, useSearchParams, useSubmit } from 'react-router'
import { ArrowDownCircle, ArrowUpCircle, Loader, MoreVertical, Search, Wallet, X } from 'lucide-react'
import type { Route } from './+types/admin.wallet'
import { requireRole } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { useT } from '~/lib/use-t'
import type { StringKey } from '~/lib/i18n'

const PAGE_SIZES = [10, 30, 50, 100, 200, 500] as const

// ─── LOADER ──────────────────────────────────────────────────────────
// Returns the paginated user list with their three wallet balances and
// pre-aggregated totalDeposit / totalWithdraw across all wallets.
//
// Aggregates use a single groupBy keyed on (userId, type) for the visible
// page only — avoids N+1 queries for every row.
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ['ADMIN', 'SUPERADMIN'])
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '30', 10)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : 30

  const where = q
    ? {
      OR: [
        { tel: { contains: q, mode: 'insensitive' as const } },
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
      ],
    }
    : {}

  // Load all users + all deposit/withdraw totals, sort by available (REAL) balance desc,
  // then paginate in memory.
  const [allUsers, allTxGroups] = await Promise.all([
    prisma.user.findMany({ where, include: { wallets: true } }),
    prisma.transaction.groupBy({
      by: ['userId', 'type'],
      where: { status: 'COMPLETED', type: { in: ['DEPOSIT', 'WITHDRAW'] } },
      _sum: { amount: true },
    }),
  ])

  const totals = new Map<string, { deposit: number; withdraw: number }>()
  for (const g of allTxGroups) {
    const cur = totals.get(g.userId) ?? { deposit: 0, withdraw: 0 }
    if (g.type === 'DEPOSIT') cur.deposit = g._sum.amount ?? 0
    else if (g.type === 'WITHDRAW') cur.withdraw = g._sum.amount ?? 0
    totals.set(g.userId, cur)
  }

  const sorted = [...allUsers].sort((a, b) => {
    const ra = a.wallets.find(w => w.type === 'REAL')?.balance ?? 0
    const rb = b.wallets.find(w => w.type === 'REAL')?.balance ?? 0
    return rb - ra
  })

  const total = sorted.length
  const users = sorted.slice((page - 1) * pageSize, page * pageSize)
  const userIds = users.map(u => u.id)

  // Fetch the latest DEPOSIT and WITHDRAW for each user on this page only.
  // Orders desc so the first occurrence per user in JS is their latest.
  const latestTxLimit = Math.max(pageSize * 6, 300)
  const [latestDeposits, latestWithdraws] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: { in: userIds }, type: 'DEPOSIT', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, amount: true },
      take: latestTxLimit,
    }),
    prisma.transaction.findMany({
      where: { userId: { in: userIds }, type: 'WITHDRAW', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, amount: true },
      take: latestTxLimit,
    }),
  ])

  const latestDepositMap = new Map<string, number>()
  const latestWithdrawMap = new Map<string, number>()
  for (const t of latestDeposits) {
    if (!latestDepositMap.has(t.userId)) latestDepositMap.set(t.userId, t.amount)
  }
  for (const t of latestWithdraws) {
    if (!latestWithdrawMap.has(t.userId)) latestWithdrawMap.set(t.userId, t.amount)
  }

  return {
    q,
    page,
    total,
    pageSize,
    users: users.map(u => {
      const t = totals.get(u.id) ?? { deposit: 0, withdraw: 0 }
      return {
        id: u.id,
        tel: u.tel,
        firstName: u.firstName,
        lastName: u.lastName,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
        real: u.wallets.find(w => w.type === 'REAL')?.balance ?? 0,
        demo: u.wallets.find(w => w.type === 'DEMO')?.balance ?? 0,
        promo: u.wallets.find(w => w.type === 'PROMO')?.balance ?? 0,
        totalDeposit: t.deposit,
        totalWithdraw: t.withdraw,
        latestDeposit:  latestDepositMap.get(u.id)  ?? null,
        latestWithdraw: latestWithdrawMap.get(u.id) ?? null,
      }
    }),
  }
}

type Row = ReturnType<typeof useLoaderData<typeof loader>>['users'][number]
type UserBase = { id: string; tel: string; name: string | null; status: string; role: string; createdAt: string }
type WalletBase = { type: string; balance: number }
type DetailData = {
  view: 'detail'
  user: UserBase
  wallet: WalletBase
  recent: {
    id: string; type: string; amount: number;
    status: string; balanceBefore: number; balanceAfter: number;
    note: string | null; createdAt: string
  }[]
}
type SummaryData = {
  view: 'summary'
  user: UserBase
  wallet: WalletBase
  incoming: { type: string; total: number; count: number }[]
  outgoing: { type: string; total: number; count: number }[]
  incomingTotal: number
  outgoingTotal: number
  calculatedAvailable: number
}

// Compact format for table cells: 999 → "999", 1,000 → "1K", 1,200,000 → "1.2M".
// Modal/detail views intentionally keep `toLocaleString()` so admins see the
// exact figure when they need it.
function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toString()
}

// Maps a transaction type to its translation key; resolved at render via t().
const TYPE_LABEL_KEYS: Record<string, StringKey> = {
  DEPOSIT: 'admin.wallet.type.deposit',
  WIN: 'admin.wallet.type.win',
  TRANSFER_IN: 'admin.wallet.type.transferIn',
  PROMO_BONUS: 'admin.wallet.type.promoBonus',
  REFERRAL_BONUS: 'admin.wallet.type.referralBonus',
  WITHDRAW: 'admin.wallet.type.withdraw',
  LOSS: 'admin.wallet.type.loss',
  TRANSFER_OUT: 'admin.wallet.type.transferOut',
  DEMO_RESET: 'admin.wallet.type.demoReset',
  ADJUSTMENT: 'admin.wallet.type.adjustment',
}

function typeLabel(t: ReturnType<typeof useT>, type: string): string {
  const k = TYPE_LABEL_KEYS[type]
  return k ? t(k) : type
}

export default function AdminWallet() {
  const t = useT()
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const submit = useSubmit()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  const [openModal, setOpenModal] = useState<{ wallet: 'REAL' | 'DEMO' | 'PROMO'; user: Row } | null>(null)

  function gotoPage(n: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(n))
    submit(next, { method: 'get' })
  }

  function setPageSize(s: number) {
    const next = new URLSearchParams(params)
    next.set('pageSize', String(s))
    next.set('page', '1')
    submit(next, { method: 'get' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('admin.wallet.title')}</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{t('admin.wallet.customerCount', { n: data.total.toLocaleString() })}</span>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={data.pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          className="rounded-lg px-2 py-2 text-xs font-bold outline-none"
          style={{ background: '#0f172a', color: '#a5b4fc', border: '1.5px solid #4338ca' }}
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{t('admin.wallet.pageSizeOption', { n: s })}</option>)}
        </select>
        <Form method="get" className="flex flex-1 items-center gap-2">
          <input type="hidden" name="page" value="1" />
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#818cf8' }} />
            <input
              name="q"
              defaultValue={data.q}
              placeholder={t('admin.wallet.searchPlaceholder')}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none"
              style={{ background: '#0f172a', color: '#fde68a', border: '1.5px solid #4338ca' }}
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-xs font-bold"
            style={{ background: '#4338ca', color: '#fff', border: '1.5px solid #818cf8' }}
          >
            {loading ? <Loader size={14} className="animate-spin" /> : t('admin.wallet.search')}
          </button>
        </Form>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {data.users.length === 0 && <Empty />}
        {data.users.map((u, i) => (
          <WalletCard key={u.id} u={u} rowNum={(data.page - 1) * data.pageSize + i + 1} onAction={(wallet) => setOpenModal({ wallet, user: u })} />
        ))}
      </div>

      {/* Desktop table */}
      <div
        className="hidden overflow-x-auto rounded-xl md:block"
        style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
      >
        <table className="w-full text-left text-sm">
          <thead style={{ color: '#a5b4fc' }}>
            <tr className="text-[10px] font-bold" style={{ background: '#1e1b4b' }}>
              <th className="w-8 px-3 py-2 text-right" style={{ color: '#64748b' }}>#</th>
              <th className="px-3 py-2">{t('admin.wallet.col.phone')}</th>
              <th className="px-3 py-2">{t('admin.wallet.col.name')}</th>
              <th className="px-3 py-2 text-right">{t('admin.wallet.col.totalDeposit')}</th>
              <th className="px-3 py-2 text-right">{t('admin.wallet.col.totalWithdraw')}</th>
              <th className="px-3 py-2 text-right">{t('admin.wallet.col.available')}</th>
              <th className="px-3 py-2 text-right">DEMO</th>
              <th className="px-3 py-2 text-right">PROMO</th>
              <th className="px-3 py-2">{t('admin.wallet.col.status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.users.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-xs" style={{ color: '#818cf8' }}>
                  {t('admin.wallet.noCustomersMatch')}
                </td>
              </tr>
            )}
            {data.users.map((u, i) => (
              <tr key={u.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                <td className="px-3 py-2 text-right text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>{(data.page - 1) * data.pageSize + i + 1}</td>
                <td className="px-3 py-2 font-semibold">{u.tel}</td>
                <td className="px-3 py-2">
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}
                </td>
                <td className="px-3 py-2 text-right" title={u.totalDeposit.toLocaleString()}>
                  <div className="font-semibold" style={{ color: '#4ade80' }}>{formatAmount(u.totalDeposit)}</div>
                  {u.latestDeposit != null && (
                    <div className="text-[10px] tabular-nums" style={{ color: '#6ee7b7' }}>↓ {formatAmount(u.latestDeposit)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right" title={u.totalWithdraw.toLocaleString()}>
                  <div className="font-semibold" style={{ color: '#f87171' }}>{formatAmount(u.totalWithdraw)}</div>
                  {u.latestWithdraw != null && (
                    <div className="text-[10px] tabular-nums" style={{ color: '#fca5a5' }}>↑ {formatAmount(u.latestWithdraw)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-bold" style={{ color: '#fde68a' }} title={u.real.toLocaleString()}>{formatAmount(u.real)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#a5b4fc' }} title={u.demo.toLocaleString()}>{formatAmount(u.demo)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#fcd34d' }} title={u.promo.toLocaleString()}>{formatAmount(u.promo)}</td>
                <td className="px-3 py-2"><StatusPill status={u.status} /></td>
                <td className="px-3 py-2 text-right">
                  <ActionMenu onPick={(wallet) => setOpenModal({ wallet, user: u })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => gotoPage(data.page - 1)}
              disabled={data.page <= 1 || loading}
              className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
              {t('admin.wallet.pagination.prev')}
            </button>
            <button type="button" onClick={() => gotoPage(data.page + 1)}
              disabled={data.page >= totalPages || loading}
              className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
              {t('admin.wallet.pagination.next')}
            </button>
          </div>
          <span className="text-xs tabular-nums" style={{ color: '#a5b4fc' }}>
            {t('admin.wallet.pagination.summary', {
              from: Math.min((data.page - 1) * data.pageSize + 1, data.total),
              to: Math.min(data.page * data.pageSize, data.total).toLocaleString(),
              total: data.total.toLocaleString(),
              page: data.page,
              totalPages,
            })}
          </span>
        </div>
      )}

      {openModal && (
        <WalletModal
          wallet={openModal.wallet}
          user={openModal.user}
          onClose={() => setOpenModal(null)}
        />
      )}
    </div>
  )
}

// ─── Modal — one fetcher per view so switching tabs only loads the data the
//   visible tab actually needs (detail = recent transactions; summary = the
//   per-type aggregate). The other tab's fetch never runs unless opened.
//   `wallet` is the account scope chosen from the action menu (REAL/DEMO/PROMO);
//   `kind` is the active tab (detail/summary), managed internally.
function WalletModal({
  wallet, user, onClose,
}: {
  wallet: 'REAL' | 'DEMO' | 'PROMO'
  user: Row
  onClose: () => void
}) {
  const t = useT()
  const [kind, setKind] = useState<'detail' | 'summary'>('detail')
  const detailFetcher = useFetcher<DetailData | { error: string }>()
  const summaryFetcher = useFetcher<SummaryData | { error: string }>()

  const active = kind === 'detail' ? detailFetcher : summaryFetcher
  const detailData = detailFetcher.data && !('error' in detailFetcher.data) ? detailFetcher.data : null
  const summaryData = summaryFetcher.data && !('error' in summaryFetcher.data) ? summaryFetcher.data : null
  const error = active.data && 'error' in active.data ? active.data.error : null

  useEffect(() => {
    if (kind === 'detail' && detailFetcher.state === 'idle' && !detailFetcher.data) {
      detailFetcher.load(`/api/admin/wallet-summary?userId=${user.id}&view=detail&wallet=${wallet}`)
    }
    if (kind === 'summary' && summaryFetcher.state === 'idle' && !summaryFetcher.data) {
      summaryFetcher.load(`/api/admin/wallet-summary?userId=${user.id}&view=summary&wallet=${wallet}`)
    }
  }, [kind, user.id, wallet, detailFetcher, summaryFetcher])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const walletLabel: Record<string, string> = { REAL: t('admin.wallet.account.real'), DEMO: t('admin.wallet.account.demo'), PROMO: t('admin.wallet.account.promo') }
  const walletColor: Record<string, string> = { REAL: '#fde68a', DEMO: '#a5b4fc', PROMO: '#fcd34d' }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm md:items-center md:p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl md:h-auto md:max-h-[90vh] md:max-w-3xl md:rounded-2xl"
        style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: '#1e1b4b', background: '#1e1b4b' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: walletColor[wallet] }}>
              <Wallet size={12} />
              {walletLabel[wallet]}
            </div>
            <div className="truncate text-sm font-bold" style={{ color: '#fde68a' }}>
              {user.tel}
              {([user.firstName, user.lastName].filter(Boolean).join(' ')) && (
                <span className="ml-2 font-normal" style={{ color: '#e9d5ff' }}>
                  · {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md text-[11px] font-bold" style={{ border: '1px solid #4338ca' }}>
              <button
                type="button"
                onClick={() => setKind('detail')}
                className="px-2.5 py-1 transition-colors"
                style={{ background: kind === 'detail' ? '#4338ca' : 'transparent', color: kind === 'detail' ? '#fff' : '#a5b4fc' }}
              >
                {t('admin.wallet.modal.detailTab')}
              </button>
              <button
                type="button"
                onClick={() => setKind('summary')}
                className="px-2.5 py-1 transition-colors"
                style={{ background: kind === 'summary' ? '#4338ca' : 'transparent', color: kind === 'summary' ? '#fff' : '#a5b4fc' }}
              >
                {t('admin.wallet.modal.summaryTab')}
              </button>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
              aria-label={t('admin.wallet.modal.close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {active.state !== 'idle' && !active.data && (
            <div className="flex h-32 items-center justify-center" style={{ color: '#a5b4fc' }}>
              <Loader size={18} className="animate-spin" />
            </div>
          )}
          {error && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid #f87171' }}>
              {error}
            </div>
          )}
          {kind === 'detail' && detailData && <DetailView data={detailData} />}
          {kind === 'summary' && summaryData && <SummaryView data={summaryData} />}
        </div>
      </div>
    </div>
  )
}

function DetailView({ data }: { data: DetailData }) {
  const t = useT()
  const walletColor: Record<string, string> = { REAL: '#fde68a', DEMO: '#a5b4fc', PROMO: '#fcd34d' }
  const color = walletColor[data.wallet.type] ?? '#e9d5ff'
  return (
    <div className="flex flex-col gap-4">
      {/* Scoped wallet balance */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: '1px solid #4338ca' }}
      >
        <div className="text-[10px] font-bold tracking-wider" style={{ color: '#a5b4fc' }}>
          {t('admin.wallet.detail.balance', { type: data.wallet.type })}
        </div>
        <div className="mt-1 text-xl font-bold md:text-3xl" style={{ color }}>
          {data.wallet.balance.toLocaleString()} ₭
        </div>
      </div>

      {/* Recent transactions */}
      <div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.wallet.detail.recentTransactions')}</div>
          <div className="text-right">
            <div className="text-[9px]" style={{ color: '#64748b' }}>{t('admin.wallet.detail.balanceAfter')}</div>
            <div className="text-xs font-bold" style={{ color }}>
              {(data.recent[0]?.balanceAfter ?? data.wallet.balance).toLocaleString()} ₭
            </div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #1e1b4b' }}>
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead style={{ color: '#a5b4fc' }}>
              <tr style={{ background: '#1e1b4b' }}>
                <th className="px-3 py-2">{t('admin.wallet.detail.col.when')}</th>
                <th className="px-3 py-2">{t('admin.wallet.detail.col.type')}</th>
                <th className="px-3 py-2 text-right">{t('admin.wallet.detail.col.amount')}</th>
                <th className="px-3 py-2">{t('admin.wallet.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center" style={{ color: '#64748b' }}>
                    {t('admin.wallet.detail.noTransactions')}
                  </td>
                </tr>
              )}
              {data.recent.map(tx => {
                const isOut = tx.type === 'WITHDRAW' || tx.type === 'LOSS' || tx.type === 'TRANSFER_OUT'
                return (
                  <tr key={tx.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#a5b4fc' }}>
                      {new Date(tx.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{typeLabel(t, tx.type)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: isOut ? '#f87171' : '#4ade80' }}>
                      {isOut ? '−' : '+'}{tx.amount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={tx.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-center">
          <a
            href={`/admin/transactions?q=${encodeURIComponent(data.user.tel)}`}
            className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
          >
{t('admin.wallet.detail.viewMore')}
          </a>
        </div>
      </div>
    </div>
  )
}

function SummaryView({ data }: { data: SummaryData }) {
  const t = useT()
  const walletColor: Record<string, string> = { REAL: '#fde68a', DEMO: '#a5b4fc', PROMO: '#fcd34d' }
  const color = walletColor[data.wallet.type] ?? '#e9d5ff'
  return (
    <div className="flex flex-col gap-4">
      {/* Two-column ledger: deposits/earnings on the left, withdraw/loss on the right. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LedgerColumn
          tone="in"
          title={t('admin.wallet.summary.depositsEarnings')}
          icon={<ArrowDownCircle size={14} />}
          rows={data.incoming}
          total={data.incomingTotal}
        />
        <LedgerColumn
          tone="out"
          title={t('admin.wallet.summary.withdrawalsLosses')}
          icon={<ArrowUpCircle size={14} />}
          rows={data.outgoing}
          total={data.outgoingTotal}
        />
      </div>

      {/* Calculated available — IN − OUT — plus the DB-recorded balance for this wallet */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: '1px solid #4338ca' }}
      >
        <div className="text-[10px] font-bold tracking-wider" style={{ color: '#a5b4fc' }}>
          {t('admin.wallet.summary.calculatedAvailable')}
        </div>
        <div className="mt-1 text-xl font-bold md:text-3xl" style={{ color: '#fde68a' }}>
          {data.calculatedAvailable.toLocaleString()} ₭
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span style={{ color: '#64748b' }}>{t('admin.wallet.summary.currentBalance', { type: data.wallet.type })}</span>
          <span className="font-bold" style={{ color }}>{data.wallet.balance.toLocaleString()} ₭</span>
        </div>
      </div>
    </div>
  )
}

function LedgerColumn({
  tone, title, icon, rows, total,
}: {
  tone: 'in' | 'out'
  title: string
  icon: React.ReactNode
  rows: { type: string; total: number; count: number }[]
  total: number
}) {
  const t = useT()
  const accent = tone === 'in' ? '#4ade80' : '#f87171'
  return (
    <div className="rounded-xl" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ background: tone === 'in' ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', borderBottom: '1px solid #1e1b4b' }}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: accent }}>
          {icon}
          {title}
        </div>
        <div className="text-xs font-bold" style={{ color: accent }}>
          {(tone === 'in' ? '+' : '−')}{total.toLocaleString()}
        </div>
      </div>
      <ul>
        {rows.map(r => (
          <li
            key={r.type}
            className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
            style={{ borderTop: '1px solid #1e1b4b' }}
          >
            <div className="flex flex-col">
              <span style={{ color: '#e9d5ff' }}>{typeLabel(t, r.type)}</span>
              <span className="text-[10px]" style={{ color: '#64748b' }}>{t('admin.wallet.summary.entryCount', { n: r.count, unit: t(r.count === 1 ? 'admin.wallet.summary.entryUnit.one' : 'admin.wallet.summary.entryUnit.many') })}</span>
            </div>
            <span style={{ color: r.total > 0 ? accent : '#64748b' }} className="font-semibold">
              {r.total.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ label, value, color, small }: { label: string; value: number; color: string; small?: boolean }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
      <div className="text-[9px] font-bold" style={{ color: '#a5b4fc' }}>{label}</div>
      <div className={small ? 'font-semibold' : 'text-base font-bold'} style={{ color }}>
        {value.toLocaleString()} ₭
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{label.toUpperCase()}</span>
      <span>{value}</span>
    </div>
  )
}

function WalletCard({ u, onAction, rowNum }: { u: Row; onAction: (wallet: 'REAL' | 'DEMO' | 'PROMO') => void; rowNum: number }) {
  const t = useT()
  return (
    <div className="rounded-xl p-3" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>#{rowNum}</span>
            <div className="text-sm font-semibold" style={{ color: '#fde68a' }}>{u.tel}</div>
          </div>
          <div className="truncate text-xs" style={{ color: '#e9d5ff' }}>
            {[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}
          </div>
        </div>
        <StatusPill status={u.status} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <CardCell label={t('admin.wallet.card.deposit')}  value={u.totalDeposit}  color="#4ade80" latest={u.latestDeposit}  latestColor="#6ee7b7" latestPrefix="↓" />
        <CardCell label={t('admin.wallet.card.withdraw')} value={u.totalWithdraw} color="#f87171" latest={u.latestWithdraw} latestColor="#fca5a5" latestPrefix="↑" />
        <CardCell label="REAL"     value={u.real}          color="#fde68a" />
        <CardCell label="DEMO"     value={u.demo}          color="#a5b4fc" />
        <CardCell label="PROMO"    value={u.promo}         color="#fcd34d" />
      </div>
      <div className="mt-2 flex justify-end">
        <ActionMenu onPick={onAction} />
      </div>
    </div>
  )
}

function CardCell({
  label, value, color, latest, latestColor, latestPrefix,
}: {
  label: string
  value: number
  color: string
  latest?: number | null
  latestColor?: string
  latestPrefix?: string
}) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }} title={value.toLocaleString()}>
      <div className="text-[9px] font-bold" style={{ color: '#a5b4fc' }}>{label}</div>
      <div className="font-semibold" style={{ color }}>{formatAmount(value)}</div>
      {latest != null && (
        <div className="text-[9px] tabular-nums" style={{ color: latestColor ?? color }}>
          {latestPrefix} {formatAmount(latest)}
        </div>
      )}
    </div>
  )
}

// Renders the dropdown into document.body via a portal so the table wrapper's
// `overflow-x-auto` (needed for narrow viewports) can't clip it. Position is
// derived from the trigger's bounding rect; we close on scroll/resize rather
// than tracking the rect, which keeps the implementation tiny.
function ActionMenu({ onPick }: { onPick: (wallet: 'REAL' | 'DEMO' | 'PROMO') => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onDismiss() { setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [open])

  function pick(wallet: 'REAL' | 'DEMO' | 'PROMO') {
    setOpen(false)
    onPick(wallet)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('admin.wallet.actionMenu.open')}
        className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:opacity-90"
        style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
      >
        <MoreVertical size={14} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] min-w-[168px] overflow-hidden rounded-md shadow-2xl"
          style={{
            top: pos.top, right: pos.right,
            background: '#0f172a', border: '1px solid #4338ca',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          }}
        >
          <MenuItem icon={<Wallet size={12} />} label={t('admin.wallet.account.real')} color="#fde68a" onClick={() => pick('REAL')} />
          <MenuItem icon={<Wallet size={12} />} label={t('admin.wallet.account.demo')} color="#a5b4fc" onClick={() => pick('DEMO')} />
          <MenuItem icon={<Wallet size={12} />} label={t('admin.wallet.account.promo')} color="#fcd34d" onClick={() => pick('PROMO')} />
        </div>,
        document.body,
      )}
    </>
  )
}

function MenuItem({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = '#1e1b4b')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors"
      style={{ color: '#e9d5ff', background: 'transparent' }}
    >
      <span style={{ color: color ?? '#a5b4fc' }}>{icon}</span>
      {label}
    </button>
  )
}

function Empty() {
  const t = useT()
  return (
    <div className="rounded-xl p-6 text-center text-xs" style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}>
      {t('admin.wallet.noCustomersMatch')}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    ACTIVE: { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' },
    SUSPENDED: { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' },
    BANNED: { bg: 'rgba(220,38,38,0.2)', color: '#f87171' },
    PENDING: { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' },
    COMPLETED: { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' },
    FAILED: { bg: 'rgba(220,38,38,0.2)', color: '#f87171' },
    CANCELLED: { bg: 'rgba(100,116,139,0.2)', color: '#94a3b8' },
  }
  const s = map[status] ?? { bg: 'rgba(100,116,139,0.2)', color: '#94a3b8' }
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}
