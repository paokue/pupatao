import { useState } from 'react'
import { Link, useLoaderData, useNavigation, useRevalidator, useSearchParams } from 'react-router'
import { Check, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Route } from './+types/admin.transactions'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyUser } from '~/lib/pusher.server'
import { ADMIN_CHANNEL, type TxCreatedPayload, type TxResolvedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { ConfirmDialog } from '~/components/ConfirmDialog'

const PAGE_SIZE = 25
type Tab = 'deposit' | 'withdraw'
type StatusFilter = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'ALL'

function isTab(v: string): v is Tab { return v === 'deposit' || v === 'withdraw' }
function isStatus(v: string): v is StatusFilter {
  return v === 'PENDING' || v === 'COMPLETED' || v === 'CANCELLED' || v === 'ALL'
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const tabRaw = url.searchParams.get('tab') ?? 'deposit'
  const statusRaw = url.searchParams.get('status') ?? 'PENDING'
  const tab: Tab = isTab(tabRaw) ? tabRaw : 'deposit'
  const status: StatusFilter = isStatus(statusRaw) ? statusRaw : 'PENDING'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)

  const txType = tab === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'
  const where = {
    type: txType as 'DEPOSIT' | 'WITHDRAW',
    ...(status === 'ALL' ? {} : { status }),
  }

  const [total, txs] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { tel: true, firstName: true, lastName: true } } },
    }),
  ])

  return {
    tab,
    status,
    page,
    total,
    pageSize: PAGE_SIZE,
    txs: txs.map(t => ({
      id: t.id,
      amount: t.amount,
      status: t.status,
      slipUrl: t.slipUrl,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
      balanceAfter: t.balanceAfter,
      user: {
        tel: t.user.tel,
        name: [t.user.firstName, t.user.lastName].filter(Boolean).join(' ') || null,
      },
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

    // Approve: re-read wallet inside the transaction so balanceBefore/After are
    // computed against the live balance (in case other writes happened between
    // the user's submit and admin's approval).
    //
    // First-topup bonuses (DEPOSIT only):
    //   New user themselves — tier bonus credited to PROMO wallet
    //     100,000 ≤ deposit < 500,000  → +10,000
    //     500,000 ≤ deposit < 1,000,000 → +50,000
    //     deposit ≥ 1,000,000           → +100,000
    //   Referrer (if any)  — flat 10,000 credited to their REAL wallet.
    // Both apply only on the *first* admin-approved DEPOSIT for the user
    // (User.firstTopupApprovedAt is null → first; non-null → already done).
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
          // Mark the user so subsequent DEPOSIT approvals don't re-grant.
          await db.user.update({
            where: { id: tx.userId },
            data: { firstTopupApprovedAt: new Date() },
          })

          // Tier bonus to the new user's PROMO wallet.
          const promoBonus = tx.amount >= 1_000_000 ? 100_000
            : tx.amount >= 500_000 ? 50_000
              : tx.amount >= 100_000 ? 10_000
                : 0
          if (promoBonus > 0) {
            const promoWallet = await db.wallet.findUnique({
              where: { userId_type: { userId: tx.userId, type: 'PROMO' } },
            })
            if (promoWallet) {
              const newPromo = promoWallet.balance + promoBonus
              await db.wallet.update({
                where: { id: promoWallet.id },
                data: { balance: newPromo, version: { increment: 1 } },
              })
              await db.transaction.create({
                data: {
                  userId: tx.userId,
                  walletId: promoWallet.id,
                  type: 'PROMO_BONUS',
                  amount: promoBonus,
                  balanceBefore: promoWallet.balance,
                  balanceAfter: newPromo,
                  status: 'COMPLETED',
                  idempotencyKey: crypto.randomUUID(),
                  note: `First-topup bonus (deposit ${tx.amount.toLocaleString()} ₭ → +${promoBonus.toLocaleString()} ₭ promo)`,
                },
              })
              bonus.promo = promoBonus
              bonus.promoNewBalance = newPromo
            }
          }

          // Referrer's 10,000 ₭ to their REAL wallet (withdrawable).
          if (user.referredById) {
            const refReal = await db.wallet.findUnique({
              where: { userId_type: { userId: user.referredById, type: 'REAL' } },
            })
            if (refReal) {
              const refNew = refReal.balance + 10_000
              await db.wallet.update({
                where: { id: refReal.id },
                data: { balance: refNew, version: { increment: 1 } },
              })
              await db.transaction.create({
                data: {
                  userId: user.referredById,
                  walletId: refReal.id,
                  type: 'REFERRAL_BONUS',
                  amount: 10_000,
                  balanceBefore: refReal.balance,
                  balanceAfter: refNew,
                  status: 'COMPLETED',
                  targetUserId: tx.userId,
                  idempotencyKey: crypto.randomUUID(),
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
      id: updated.id,
      status: 'COMPLETED',
      type: updated.type as 'DEPOSIT' | 'WITHDRAW',
      amount: updated.amount,
      balanceAfter: updated.balanceAfter,
      note: updated.note,
    })
    notifyAdmin('transaction:resolved', { id: updated.id })

    // Bonus toasts piggyback on the existing transaction:updated channel
    // so the customer's wallet/header re-reads its balance.
    if (bonus.promo > 0) {
      notifyUser(tx.userId, 'transaction:updated', {
        id: `promo-bonus:${updated.id}`,
        status: 'COMPLETED',
        type: 'DEPOSIT',
        amount: bonus.promo,
        balanceAfter: bonus.promoNewBalance,
        note: `First-topup bonus +${bonus.promo.toLocaleString()} ₭ to promo wallet`,
      })
    }
    if (bonus.referrer.userId) {
      notifyUser(bonus.referrer.userId, 'transaction:updated', {
        id: `referral-bonus:${updated.id}`,
        status: 'COMPLETED',
        type: 'DEPOSIT',
        amount: bonus.referrer.amount,
        balanceAfter: bonus.referrer.newRealBalance,
        note: `Referral bonus +${bonus.referrer.amount.toLocaleString()} ₭ — your referee just joined`,
      })
    }

    return { ok: true }
  } catch (err) {
    console.error('[admin/transactions]', err)
    return { error: err instanceof Error ? err.message : 'Action failed.' }
  }
}

const STATUS_FILTERS: StatusFilter[] = ['PENDING', 'COMPLETED', 'CANCELLED', 'ALL']

type PendingAction = { tx: TxLite; op: 'approve' | 'reject' } | null

export default function AdminTransactions() {
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  const [pending, setPending] = useState<PendingAction>(null)

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
    // Another admin resolved a row — refresh so the list stays accurate.
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

      {/* Tab: Deposit / Withdraw */}
      <div className="flex gap-2">
        {(['deposit', 'withdraw'] as Tab[]).map(t => (
          <Link
            key={t}
            to={tabHref(t)}
            className="rounded-lg px-4 py-1.5 text-xs font-bold  capitalize"
            style={{
              background: data.tab === t ? '#4338ca' : '#1e1b4b',
              color: data.tab === t ? '#fff' : '#a5b4fc',
              border: `1px solid ${data.tab === t ? '#818cf8' : '#4338ca'}`,
            }}
          >
            {t}
          </Link>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map(s => (
          <Link
            key={s}
            to={statusHref(s)}
            className="rounded-md px-2 py-1 text-[10px] font-bold "
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

      <div className="flex flex-col gap-2">
        {data.txs.length === 0 && (
          <div
            className="rounded-xl p-8 text-center text-xs"
            style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
          >
            No {data.tab} transactions match.
          </div>
        )}
        {data.txs.map(tx => (
          <TxCard
            key={tx.id}
            tx={tx}
            loading={loading}
            onApprove={() => setPending({ tx, op: 'approve' })}
            onReject={() => setPending({ tx, op: 'reject' })}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {data.page > 1 && (
            <Link
              to={pageHref(data.page - 1)}
              className="rounded-md px-3 py-1.5 text-xs font-bold"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
            >
              ← Prev
            </Link>
          )}
          <span className="text-xs" style={{ color: '#a5b4fc' }}>
            Page {data.page} / {totalPages}
          </span>
          {data.page < totalPages && (
            <Link
              to={pageHref(data.page + 1)}
              className="rounded-md px-3 py-1.5 text-xs font-bold"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
            >
              Next →
            </Link>
          )}
        </div>
      )}

      {pending && (
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
                ? `${pending.tx.user.tel} will be credited ${pending.tx.amount.toLocaleString()} ₭ on their REAL wallet.`
                : `${pending.tx.user.tel} will be debited ${pending.tx.amount.toLocaleString()} ₭ from their REAL wallet.`
              : `${pending.tx.user.tel} will be notified the request was rejected. No balance change.`
          }
          tone={pending.op === 'approve' ? 'success' : 'danger'}
          confirmLabel={pending.op === 'approve' ? 'APPROVE' : 'REJECT'}
          fields={{ txId: pending.tx.id, op: pending.op }}
        />
      )}
    </div>
  )
}

type TxLite = ReturnType<typeof useLoaderData<typeof loader>>['txs'][number]

function TxCard({
  tx,
  loading,
  onApprove,
  onReject,
}: {
  tx: TxLite
  loading: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const isPending = tx.status === 'PENDING'
  const statusStyle =
    tx.status === 'COMPLETED'
      ? { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' }
      : tx.status === 'PENDING'
        ? { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' }
        : { bg: 'rgba(220,38,38,0.2)', color: '#f87171' }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4 md:flex-row md:items-center"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      {tx.slipUrl && (
        <a
          href={tx.slipUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ background: '#1e1b4b', border: '1px solid #4338ca' }}
          aria-label="View slip"
        >
          {tx.slipUrl.endsWith('.pdf') ? (
            <span className="text-xs font-bold" style={{ color: '#fde68a' }}>📄 PDF</span>
          ) : (
            <img src={tx.slipUrl} alt="Slip" className="h-full w-full object-cover" />
          )}
        </a>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold" style={{ color: '#e9d5ff' }}>
            {tx.user.name ? `${tx.user.name} · ` : ''}{tx.user.tel}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold "
            style={{ background: statusStyle.bg, color: statusStyle.color }}
          >
            {tx.status}
          </span>
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
            <button
              type="button"
              onClick={onReject}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold  disabled:opacity-50"
              style={{ background: '#7f1d1d', color: '#fff', border: '1px solid #fca5a5' }}
            >
              <X size={10} />
              REJECT
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold  disabled:opacity-50"
              style={{ background: '#14532d', color: '#fff', border: '1px solid #4ade80' }}
            >
              <Check size={10} />
              APPROVE
            </button>
          </div>
        ) : (
          tx.slipUrl && (
            <a
              href={tx.slipUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-bold  underline"
              style={{ color: '#a5b4fc' }}
            >
              <ExternalLink size={10} /> SLIP
            </a>
          )
        )}
      </div>
    </div>
  )
}
