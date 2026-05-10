import { useEffect, useState } from 'react'
import { Form, Link, useLoaderData, useNavigation, useRevalidator, useSearchParams } from 'react-router'
import { ArrowRight, Check, Loader, Maximize2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Route } from './+types/admin.transactions'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyUser } from '~/lib/pusher.server'
import { ADMIN_CHANNEL, type TxCreatedPayload, type TxResolvedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { ConfirmDialog } from '~/components/ConfirmDialog'

const PAGE_SIZE = 25
type Tab = 'deposit' | 'withdraw' | 'transfer'
type StatusFilter = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'ALL'

function isTab(v: string): v is Tab { return v === 'deposit' || v === 'withdraw' || v === 'transfer' }
function isStatus(v: string): v is StatusFilter {
  return v === 'PENDING' || v === 'COMPLETED' || v === 'CANCELLED' || v === 'ALL'
}

const USER_SELECT = { tel: true, firstName: true, lastName: true }

function userName(u: { tel: string; firstName: string | null; lastName: string | null }) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.tel
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const tabRaw = url.searchParams.get('tab') ?? 'deposit'
  const statusRaw = url.searchParams.get('status') ?? 'ALL'
  const tab: Tab = isTab(tabRaw) ? tabRaw : 'deposit'
  const status: StatusFilter = isStatus(statusRaw) ? statusRaw : 'ALL'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const q = url.searchParams.get('q')?.trim() ?? ''

  // Phone-number filter on the user (sender) — and on the target user too for
  // transfers, so admins can find a transfer by either side's tel.
  const telFilter = q
    ? { user: { is: { tel: { contains: q, mode: 'insensitive' as const } } } }
    : {}
  const transferTelFilter = q
    ? {
      OR: [
        { user: { is: { tel: { contains: q, mode: 'insensitive' as const } } } },
        { targetUser: { is: { tel: { contains: q, mode: 'insensitive' as const } } } },
      ],
    }
    : {}

  const [pendingDepositCount, pendingWithdrawCount, pendingTransferCount] = await Promise.all([
    prisma.transaction.count({ where: { type: 'DEPOSIT', status: 'PENDING' } }),
    prisma.transaction.count({ where: { type: 'WITHDRAW', status: 'PENDING' } }),
    prisma.transaction.count({ where: { type: 'TRANSFER_OUT', status: 'PENDING' } }),
  ])

  if (tab === 'transfer') {
    const cfInclude = { user: { select: USER_SELECT }, targetUser: { select: USER_SELECT } }
    const baseWhere = { type: 'TRANSFER_OUT' as const, ...transferTelFilter }

    let total: number
    let rows: Awaited<ReturnType<typeof prisma.transaction.findMany<{ include: typeof cfInclude }>>>

    if (status === 'ALL') {
      const [count, pendingRows, otherRows] = await Promise.all([
        prisma.transaction.count({ where: baseWhere }),
        prisma.transaction.findMany({ where: { ...baseWhere, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, include: cfInclude }),
        prisma.transaction.findMany({ where: { ...baseWhere, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: cfInclude }),
      ])
      total = count
      rows = [...pendingRows, ...otherRows].slice(0, PAGE_SIZE)
    } else {
      const where = { ...baseWhere, status }
      const [count, items] = await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: cfInclude }),
      ])
      total = count
      rows = items
    }

    return {
      tab,
      status,
      q,
      page,
      total,
      pageSize: PAGE_SIZE,
      pendingDepositCount,
      pendingWithdrawCount,
      pendingTransferCount,
      txs: rows.map(t => ({
        id: t.id,
        type: 'transfer' as const,
        amount: t.amount,
        status: t.status,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
        balanceAfter: t.balanceAfter,
        slipUrl: null as string | null,
        sender: { tel: t.user.tel, name: userName(t.user) },
        recipient: t.targetUser
          ? { tel: t.targetUser.tel, name: userName(t.targetUser) }
          : null,
      })),
    }
  }

  // Deposit / Withdraw
  const txType = tab === 'deposit' ? 'DEPOSIT' as const : 'WITHDRAW' as const
  const baseWhere = { type: txType, ...telFilter }

  let total: number
  let rows: Awaited<ReturnType<typeof prisma.transaction.findMany<{ include: { user: { select: typeof USER_SELECT } } }>>>

  if (status === 'ALL') {
    const [count, pendingRows, otherRows] = await Promise.all([
      prisma.transaction.count({ where: baseWhere }),
      prisma.transaction.findMany({ where: { ...baseWhere, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, include: { user: { select: USER_SELECT } } }),
      prisma.transaction.findMany({ where: { ...baseWhere, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: { select: USER_SELECT } } }),
    ])
    total = count
    rows = [...pendingRows, ...otherRows].slice(0, PAGE_SIZE)
  } else {
    const where = { ...baseWhere, status }
    const [count, items] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: { select: USER_SELECT } } }),
    ])
    total = count
    rows = items
  }

  const txs = rows

  return {
    tab,
    status,
    q,
    page,
    total,
    pageSize: PAGE_SIZE,
    pendingDepositCount,
    pendingWithdrawCount,
    pendingTransferCount,
    txs: txs.map(t => ({
      id: t.id,
      type: tab as 'deposit' | 'withdraw',
      amount: t.amount,
      status: t.status,
      slipUrl: t.slipUrl ?? null,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
      balanceAfter: t.balanceAfter,
      sender: { tel: t.user.tel, name: userName(t.user) },
      recipient: null as null,
    })),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')
  const txId = String(fd.get('txId') ?? '')
  if (!txId) return { error: 'txId required' }

  if (op !== 'approve' && op !== 'reject') return { error: 'Unknown op' }

  try {
    const tx = await prisma.transaction.findUnique({ where: { id: txId } })
    if (!tx) return { error: 'Transaction not found.' }
    if (tx.status !== 'PENDING') return { error: 'Only pending transactions can be reviewed.' }

    if (op === 'reject') {
      const [updated] = await prisma.$transaction([
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'CANCELLED', note: `${tx.note ?? 'Deposit'} — rejected by admin` },
        }),
        prisma.auditLog.create({
          data: {
            actorId: admin.id,
            action: tx.type === 'DEPOSIT' ? 'deposit.reject' : 'withdraw.reject',
            target: `transaction:${tx.id}`,
          },
        }),
      ])
      notifyUser(tx.userId, 'transaction:updated', {
        id: updated.id,
        status: 'CANCELLED',
        type: updated.type as 'DEPOSIT' | 'WITHDRAW',
        amount: updated.amount,
        balanceAfter: updated.balanceAfter,
        note: updated.note,
      })
      notifyAdmin('transaction:resolved', { id: updated.id })
      return { ok: true }
    }

    const result = await prisma.$transaction(async db => {
      const wallet = await db.wallet.findUnique({ where: { id: tx.walletId } })
      if (!wallet) throw new Error('Wallet not found.')

      const delta = tx.type === 'DEPOSIT' ? tx.amount : -tx.amount
      const newBalance = wallet.balance + delta
      if (newBalance < 0) throw new Error('Insufficient balance to approve withdraw.')

      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance, version: { increment: 1 } },
      })
      const u = await db.transaction.update({
        where: { id: tx.id },
        data: {
          status: 'COMPLETED',
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          note: `${tx.note ?? (tx.type === 'DEPOSIT' ? 'Deposit' : 'Withdraw')} — approved by admin`,
        },
      })
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: tx.type === 'DEPOSIT' ? 'deposit.approve' : 'withdraw.approve',
          target: `transaction:${tx.id}`,
          metadata: { amount: tx.amount, walletId: tx.walletId, newBalance },
        },
      })

      const bonus = { promo: 0, promoNewBalance: 0, referrer: { userId: '', amount: 0, newRealBalance: 0 } }
      if (tx.type === 'DEPOSIT') {
        const user = await db.user.findUnique({
          where: { id: tx.userId },
          select: { id: true, firstTopupApprovedAt: true, referredById: true },
        })
        const isFirstApproval = user && !user.firstTopupApprovedAt
        if (isFirstApproval) {
          await db.user.update({ where: { id: tx.userId }, data: { firstTopupApprovedAt: new Date() } })
          const promoBonus = tx.amount >= 1_000_000 ? 100_000
            : tx.amount >= 500_000 ? 50_000
              : tx.amount >= 100_000 ? 10_000 : 0
          if (promoBonus > 0) {
            const promoWallet = await db.wallet.findUnique({
              where: { userId_type: { userId: tx.userId, type: 'PROMO' } },
            })
            if (promoWallet) {
              const newPromo = promoWallet.balance + promoBonus
              await db.wallet.update({ where: { id: promoWallet.id }, data: { balance: newPromo, version: { increment: 1 } } })
              await db.transaction.create({
                data: {
                  userId: tx.userId, walletId: promoWallet.id, type: 'PROMO_BONUS',
                  amount: promoBonus, balanceBefore: promoWallet.balance, balanceAfter: newPromo,
                  status: 'COMPLETED', idempotencyKey: crypto.randomUUID(),
                  note: `First-topup bonus (deposit ${tx.amount.toLocaleString()} ₭ → +${promoBonus.toLocaleString()} ₭ promo)`,
                },
              })
              bonus.promo = promoBonus
              bonus.promoNewBalance = newPromo
            }
          }
          if (user.referredById) {
            const refReal = await db.wallet.findUnique({
              where: { userId_type: { userId: user.referredById, type: 'REAL' } },
            })
            if (refReal) {
              const refNew = refReal.balance + 10_000
              await db.wallet.update({ where: { id: refReal.id }, data: { balance: refNew, version: { increment: 1 } } })
              await db.transaction.create({
                data: {
                  userId: user.referredById, walletId: refReal.id, type: 'REFERRAL_BONUS',
                  amount: 10_000, balanceBefore: refReal.balance, balanceAfter: refNew,
                  status: 'COMPLETED', targetUserId: tx.userId, idempotencyKey: crypto.randomUUID(),
                  note: `Referral bonus — referee ${tx.userId.slice(-6)} first-topup approved`,
                },
              })
              bonus.referrer = { userId: user.referredById, amount: 10_000, newRealBalance: refNew }
            }
          }
        }
      }
      return { updated: u, bonus }
    })

    const { updated, bonus } = result
    notifyUser(tx.userId, 'transaction:updated', {
      id: updated.id, status: 'COMPLETED',
      type: updated.type as 'DEPOSIT' | 'WITHDRAW',
      amount: updated.amount, balanceAfter: updated.balanceAfter, note: updated.note,
    })
    notifyAdmin('transaction:resolved', { id: updated.id })
    if (bonus.promo > 0) {
      notifyUser(tx.userId, 'transaction:updated', {
        id: `promo-bonus:${updated.id}`, status: 'COMPLETED', type: 'DEPOSIT',
        amount: bonus.promo, balanceAfter: bonus.promoNewBalance,
        note: `First-topup bonus +${bonus.promo.toLocaleString()} ₭ to promo wallet`,
      })
    }
    if (bonus.referrer.userId) {
      notifyUser(bonus.referrer.userId, 'transaction:updated', {
        id: `referral-bonus:${updated.id}`, status: 'COMPLETED', type: 'DEPOSIT',
        amount: bonus.referrer.amount, balanceAfter: bonus.referrer.newRealBalance,
        note: `Referral bonus +${bonus.referrer.amount.toLocaleString()} ₭ — your referee just joined`,
      })
    }
    return { ok: true }
  } catch (err) {
    console.error('[admin/transactions]', err)
    return { error: err instanceof Error ? err.message : 'Action failed.' }
  }
}

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'COMPLETED', 'CANCELLED']
const TABS: { key: Tab; label: string }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'transfer', label: 'Transfer' },
]

type TxLite = ReturnType<typeof useLoaderData<typeof loader>>['txs'][number]
type PendingAction = { tx: TxLite; op: 'approve' | 'reject' } | null

export default function AdminTransactions() {
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  const [pending, setPending] = useState<PendingAction>(null)
  // Active slip URL for the fullscreen preview modal — null = closed.
  const [slipPreview, setSlipPreview] = useState<string | null>(null)

  usePusherEvent<TxCreatedPayload>(ADMIN_CHANNEL, 'transaction:created', tx => {
    if (tx.type !== 'DEPOSIT' && tx.type !== 'WITHDRAW') return
    const isOnTab =
      (data.tab === 'deposit' && tx.type === 'DEPOSIT') ||
      (data.tab === 'withdraw' && tx.type === 'WITHDRAW')
    if (!isOnTab) return
    if (data.status !== 'PENDING' && data.status !== 'ALL') return
    toast.message('New ' + tx.type.toLowerCase() + ' request', {
      description: `${tx.user.tel} · ${tx.amount.toLocaleString()} ₭`,
    })
    revalidator.revalidate()
  })

  usePusherEvent<TxResolvedPayload>(ADMIN_CHANNEL, 'transaction:resolved', () => {
    revalidator.revalidate()
  })

  function tabHref(tab: Tab) {
    const next = new URLSearchParams(params)
    next.set('tab', tab)
    next.delete('page')
    return `?${next.toString()}`
  }
  function statusHref(s: StatusFilter) {
    const next = new URLSearchParams(params)
    next.set('status', s)
    next.delete('page')
    return `?${next.toString()}`
  }
  function pageHref(p: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(p))
    return `?${next.toString()}`
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Transactions</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{data.total.toLocaleString()} total</span>
      </div>

      {/* Filters bar — tabs + status on the left, phone search on the right.
          Stacks on mobile; aligns side-by-side from md+. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        {/* LEFT: tabs (row) + status pills (row) stacked */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {TABS.map(t => {
              const count = t.key === 'deposit' ? data.pendingDepositCount : t.key === 'withdraw' ? data.pendingWithdrawCount : data.pendingTransferCount
              return (
                <Link
                  key={t.key}
                  to={tabHref(t.key)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold capitalize"
                  style={{
                    background: data.tab === t.key ? '#4338ca' : '#1e1b4b',
                    color: data.tab === t.key ? '#fff' : '#a5b4fc',
                    border: `1px solid ${data.tab === t.key ? '#818cf8' : '#4338ca'}`,
                  }}
                >
                  {t.label}
                  {count > 0 && (
                    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold" style={{ background: '#ef4444', color: '#fff' }}>
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(s => (
              <Link
                key={s}
                to={statusHref(s)}
                className="rounded-md px-2 py-1 text-[10px] font-bold"
                style={{
                  background: data.status === s ? '#1e1b4b' : 'transparent',
                  color: data.status === s ? '#fde68a' : '#818cf8',
                  border: `1px solid ${data.status === s ? '#4338ca' : '#1e1b4b'}`,
                }}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT: phone-number filter — preserves active tab/status, resets
            to page 1 on submit so we don't land out-of-range. */}
        <Form method="get" className="flex items-center gap-2 md:w-96 md:shrink-0">
          <input type="hidden" name="tab" value={data.tab} />
          <input type="hidden" name="status" value={data.status} />
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

      <div className="flex flex-col gap-2">
        {data.txs.length === 0 && (
          <div
            className="rounded-xl p-8 text-center text-xs"
            style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
          >
            No {data.tab} transactions match.
          </div>
        )}
        {data.txs.map((tx, i) =>
          tx.type === 'transfer' ? (
            <TransferCard key={tx.id} tx={tx} rowNum={(data.page - 1) * data.pageSize + i + 1} />
          ) : (
            <TxCard
              key={tx.id}
              tx={tx}
              rowNum={(data.page - 1) * data.pageSize + i + 1}
              tab={data.tab as 'deposit' | 'withdraw'}
              loading={loading}
              onApprove={() => setPending({ tx, op: 'approve' })}
              onReject={() => setPending({ tx, op: 'reject' })}
              onSlipPreview={url => setSlipPreview(url)}
            />
          )
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            {data.page > 1 && (
              <Link to={pageHref(data.page - 1)} className="rounded-md px-3 py-1.5 text-xs font-bold"
                style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                ← Prev
              </Link>
            )}
            {data.page < totalPages && (
              <Link to={pageHref(data.page + 1)} className="rounded-md px-3 py-1.5 text-xs font-bold"
                style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                Next →
              </Link>
            )}
          </div>
          <span className="text-xs tabular-nums" style={{ color: '#a5b4fc' }}>
            Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total).toLocaleString()} of {data.total.toLocaleString()} transactions · Page {data.page}/{totalPages}
          </span>
        </div>
      )}

      {slipPreview && (
        <SlipPreview url={slipPreview} onClose={() => setSlipPreview(null)} />
      )}

      {pending && pending.tx.type !== 'transfer' && (
        <ConfirmDialog
          open={!!pending}
          onClose={() => setPending(null)}
          title={
            pending.op === 'approve'
              ? `Approve ${pending.tx.amount.toLocaleString()} ₭ ${data.tab}?`
              : `Reject this ${data.tab} request?`
          }
          description={
            pending.op === 'approve'
              ? data.tab === 'deposit'
                ? `${pending.tx.sender.tel} will be credited ${pending.tx.amount.toLocaleString()} ₭ on their REAL wallet.`
                : `${pending.tx.sender.tel} will be debited ${pending.tx.amount.toLocaleString()} ₭ from their REAL wallet.`
              : `${pending.tx.sender.tel} will be notified the request was rejected. No balance change.`
          }
          tone={pending.op === 'approve' ? 'success' : 'danger'}
          confirmLabel={pending.op === 'approve' ? 'APPROVE' : 'REJECT'}
          fields={{ txId: pending.tx.id, op: pending.op }}
        />
      )}
    </div>
  )
}

function statusStyle(status: string) {
  if (status === 'COMPLETED') return { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' }
  if (status === 'PENDING') return { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' }
  return { bg: 'rgba(220,38,38,0.2)', color: '#f87171' }
}

function StatusBadge({ status }: { status: string }) {
  const s = statusStyle(status)
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}

function TxCard({
  tx, tab, loading, rowNum, onApprove, onReject, onSlipPreview,
}: {
  tx: TxLite
  tab: 'deposit' | 'withdraw'
  loading: boolean
  rowNum: number
  onApprove: () => void
  onReject: () => void
  onSlipPreview: (url: string) => void
}) {
  const isPending = tx.status === 'PENDING'
  return (
    <div className="flex flex-col gap-3 rounded-xl p-4 md:flex-row md:items-center"
      style={{ background: '#0f172a', border: `1px solid ${isPending ? '#4338ca' : '#1e1b4b'}` }}>
      {tx.slipUrl && (
        <button
          type="button"
          onClick={() => onSlipPreview(tx.slipUrl!)}
          className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg transition-opacity hover:opacity-80"
          style={{ background: '#1e1b4b', border: '1px solid #4338ca' }}
          aria-label="Preview slip"
        >
          {tx.slipUrl.endsWith('.pdf')
            ? <span className="text-xs font-bold" style={{ color: '#fde68a' }}>📄 PDF</span>
            : <img src={tx.slipUrl} alt="Slip" className="h-full w-full object-cover" />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>#{rowNum}</span>
          <span className="font-semibold" style={{ color: '#e9d5ff' }}>
            {tx.sender.name !== tx.sender.tel ? `${tx.sender.name} · ` : ''}{tx.sender.tel}
          </span>
          <StatusBadge status={tx.status} />
        </div>
        <div className="mt-0.5 text-xs" style={{ color: '#818cf8' }}>
          {new Date(tx.createdAt).toLocaleString()}
        </div>
        {tx.note && <div className="mt-1 text-xs" style={{ color: '#a5b4fc' }}>{tx.note}</div>}
      </div>
      <div className="flex items-center gap-3 md:flex-col md:items-end">
        <span className="text-lg font-bold" style={{ color: '#fde68a' }}>
          {tx.amount.toLocaleString()} ₭
        </span>
        {isPending ? (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onReject} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50"
              style={{ background: '#7f1d1d', color: '#fff', border: '1px solid #fca5a5' }}>
              <X size={10} /> REJECT
            </button>
            <button type="button" onClick={onApprove} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50"
              style={{ background: '#14532d', color: '#fff', border: '1px solid #4ade80' }}>
              <Check size={10} /> APPROVE
            </button>
          </div>
        ) : (
          tx.slipUrl && (
            <button
              type="button"
              onClick={() => onSlipPreview(tx.slipUrl!)}
              className="inline-flex items-center gap-1 text-[10px] font-bold underline"
              style={{ color: '#a5b4fc' }}
            >
              <Maximize2 size={10} /> SLIP
            </button>
          )
        )}
      </div>
    </div>
  )
}

function TransferCard({ tx, rowNum }: { tx: TxLite; rowNum: number }) {
  const isPending = tx.status === 'PENDING'
  const isEncrypted = tx.note ? /encrypt/i.test(tx.note) : false

  return (
    <div className="flex flex-col gap-3 rounded-xl p-4 md:flex-row md:items-center"
      style={{ background: '#0f172a', border: `1px solid ${isPending ? '#4338ca' : '#1e1b4b'}` }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Sender → Recipient */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>#{rowNum}</span>
            <span className="font-semibold" style={{ color: '#e9d5ff' }}>{tx.sender.name}</span>
            <ArrowRight size={12} style={{ color: '#818cf8' }} />
            {tx.recipient ? (
              <span className="font-semibold" style={{ color: '#e9d5ff' }}>{tx.recipient.name}</span>
            ) : (
              <span className="text-xs" style={{ color: '#818cf8' }}>Unknown recipient</span>
            )}
          </div>
          <StatusBadge status={tx.status} />
          {/* Transfer type badge */}
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: isEncrypted ? 'rgba(124,58,237,0.2)' : 'rgba(59,130,246,0.2)', color: isEncrypted ? '#c4b5fd' : '#93c5fd' }}>
            {isEncrypted ? 'ENCRYPTED' : 'NORMAL'}
          </span>
        </div>

        {/* Sender tel + recipient tel */}
        <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: '#818cf8' }}>
          <span>{tx.sender.tel}</span>
          <ArrowRight size={10} />
          <span>{tx.recipient?.tel ?? '—'}</span>
        </div>

        <div className="mt-0.5 text-xs" style={{ color: '#818cf8' }}>
          {new Date(tx.createdAt).toLocaleString()}
        </div>
        {tx.note && <div className="mt-1 text-xs" style={{ color: '#a5b4fc' }}>{tx.note}</div>}
      </div>

      <div className="flex items-center gap-3 md:flex-col md:items-end">
        <span className="text-lg font-bold" style={{ color: '#fde68a' }}>
          {tx.amount.toLocaleString()} ₭
        </span>
        <span className="text-[10px]" style={{ color: '#818cf8' }}>
          Balance after: {tx.balanceAfter.toLocaleString()} ₭
        </span>
      </div>
    </div>
  )
}

// Fullscreen viewer for a payment slip. Click backdrop or press Esc to close.
// PDFs render via <iframe>; everything else is treated as an image with
// `object-contain` so it never overflows the viewport.
function SlipPreview({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const isPdf = url.toLowerCase().endsWith('.pdf')

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Slip preview"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-80"
        style={{ background: '#0f172a', color: '#fde68a', border: '1px solid #4338ca' }}
        aria-label="Close preview"
      >
        <X size={18} />
      </button>
      <div className="flex h-full w-full items-center justify-center p-4 md:p-10" onClick={e => e.stopPropagation()}>
        {isPdf ? (
          <iframe
            src={url}
            title="Slip PDF"
            className="h-full w-full max-w-5xl rounded-lg"
            style={{ background: '#fff', border: '1px solid #4338ca' }}
          />
        ) : (
          <img
            src={url}
            alt="Payment slip"
            className="max-h-full max-w-full rounded-lg object-contain"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          />
        )}
      </div>
    </div>
  )
}
