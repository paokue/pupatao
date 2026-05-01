import { useState, useMemo, useEffect } from 'react'
import { useLoaderData, useNavigate, useNavigation, useRevalidator } from 'react-router'
import { ArrowLeft, Eye, EyeOff, Loader, Wallet as WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Route } from './+types/wallet'
import bcrypt from 'bcryptjs'
import { requireUser } from '~/lib/auth.server'
import { prisma } from '~/lib/prisma.server'
import { notifyAdmin, notifyUser } from '~/lib/pusher.server'
import { useUIStore } from '~/lib/ui-store'
import { userChannel, type TxCreatedPayload, type TxUpdatedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { playClick } from '~/hooks/use-sound-engine'
import { DepositModal } from '~/components/DepositModal'
import { WithdrawModal } from '~/components/WithdrawModal'
import { TransferModal } from '~/components/TransferModal'
import { ClaimTransferModal } from '~/components/ClaimTransferModal'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { useT } from '~/lib/use-t'

const HIDDEN = '••••••'
const MIN_DEPOSIT = 5_000
const MAX_DEPOSIT = 10_000_000
const MIN_WITHDRAW = 10_000
const MAX_WITHDRAW = 10_000_000
const MIN_TRANSFER = 10_000
const MAX_TRANSFER = 10_000_000
const MAX_LOCK_ATTEMPTS = 5
// Loader fetches up to 200 rows per tab; the page paginates client-side
// in 20-row windows ("Load more" button).
const PAGE_SIZE = 200
const VISIBLE_INITIAL = 20
const VISIBLE_STEP = 20

const DEPOSIT_AMOUNTS = [5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000]
const WITHDRAW_AMOUNTS = [10_000, 50_000, 100_000, 200_000, 500_000, 1_000_000]
const TRANSFER_AMOUNTS = [20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000]

type Tab = 'deposit' | 'withdraw' | 'transfer'

function formatDate(ts: string | number): string {
  return new Date(ts).toLocaleString()
}

function formatAmount(n: number): string {
  return n.toLocaleString()
}

function toTxCreatedPayload(
  tx: { id: string; type: string; amount: number; status: string; createdAt: Date },
  user: { id: string; tel: string; firstName: string | null; lastName: string | null },
): TxCreatedPayload {
  return {
    id: tx.id,
    type: tx.type as TxCreatedPayload['type'],
    amount: tx.amount,
    status: tx.status,
    createdAt: tx.createdAt.toISOString(),
    user: {
      id: user.id,
      tel: user.tel,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — real-wallet balance, lifetime totals, and recent txs per tab.
// ─────────────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const wallet = await prisma.wallet.findUnique({
    where: { userId_type: { userId: user.id, type: 'REAL' } },
  })
  if (!wallet) {
    // Shouldn't happen — register creates both wallets — but be defensive.
    throw new Response('Real wallet not found for this account.', { status: 500 })
  }
  // PROMO is read-only here (no deposit/withdraw/transfer affordances).
  // Just surface the balance so customers see the bonus they can play with.
  const promoWallet = await prisma.wallet.findUnique({
    where: { userId_type: { userId: user.id, type: 'PROMO' } },
    select: { balance: true },
  })
  const promoBalance = promoWallet?.balance ?? 0

  // Aggregates + history per tab + bank QR + pending locked transfers (sent
  // and received). Pending transfers drive the receive list and sender's
  // "cancel" affordance on the wallet's transfer tab.
  const [
    depositAgg,
    withdrawAgg,
    deposits,
    withdraws,
    transfers,
    bank,
    pendingReceived,
    pendingSent,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { walletId: wallet.id, type: 'DEPOSIT', status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { walletId: wallet.id, type: 'WITHDRAW', status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { walletId: wallet.id, type: 'DEPOSIT' },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.transaction.findMany({
      where: { walletId: wallet.id, type: 'WITHDRAW' },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.transaction.findMany({
      where: { walletId: wallet.id, type: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.bank.findUnique({ where: { userId: user.id }, select: { qrUrl: true } }),
    prisma.transfer.findMany({
      where: { receiverId: user.id, status: { in: ['PENDING', 'LOCKED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sender: { select: { tel: true, firstName: true, lastName: true } } },
    }),
    prisma.transfer.findMany({
      where: { senderId: user.id, status: { in: ['PENDING', 'LOCKED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { receiver: { select: { tel: true, firstName: true, lastName: true } } },
    }),
  ])

  const serialize = (t: typeof deposits[number]) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    status: t.status,
    note: t.note,
    slipUrl: t.slipUrl,
    createdAt: t.createdAt.toISOString(),
    targetUserId: t.targetUserId,
  })

  function summarisePeer(p: { tel: string; firstName: string | null; lastName: string | null }) {
    return {
      tel: p.tel,
      name: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
    }
  }

  return {
    me: { id: user.id, tel: user.tel },
    balance: wallet.balance,
    promoBalance,
    totalDeposit: depositAgg._sum.amount ?? 0,
    totalWithdraw: withdrawAgg._sum.amount ?? 0,
    deposits: deposits.map(serialize),
    withdraws: withdraws.map(serialize),
    transfers: transfers.map(serialize),
    bankQrUrl: bank?.qrUrl ?? null,
    pendingReceived: pendingReceived.map(t => ({
      id: t.id,
      amount: t.amount,
      status: t.status,
      failedAttempts: t.failedAttempts,
      lockedAt: t.lockedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      sender: summarisePeer(t.sender),
    })),
    pendingSent: pendingSent.map(t => ({
      id: t.id,
      amount: t.amount,
      status: t.status,
      failedAttempts: t.failedAttempts,
      lockedAt: t.lockedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      receiver: summarisePeer(t.receiver),
    })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — handles deposit submissions (withdraw/transfer to follow).
// ─────────────────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const form = await request.formData()
  const op = String(form.get('op') ?? '')

  if (op === 'deposit') {
    const amount = parseInt(String(form.get('amount') ?? ''), 10)
    const slipUrl = String(form.get('slipUrl') ?? '').trim()

    if (!Number.isFinite(amount) || amount < MIN_DEPOSIT) {
      return { op, error: `Minimum deposit is ${MIN_DEPOSIT.toLocaleString()} ₭.` }
    }
    if (amount > MAX_DEPOSIT) {
      return { op, error: `Maximum deposit is ${MAX_DEPOSIT.toLocaleString()} ₭.` }
    }
    if (!slipUrl) {
      return { op, error: 'Please upload your payment slip before confirming.' }
    }

    try {
      const wallet = await prisma.wallet.findUnique({
        where: { userId_type: { userId: user.id, type: 'REAL' } },
      })
      if (!wallet) return { op, error: 'Real wallet not found.' }

      // PENDING — admin verifies the slip, then credits the balance.
      // idempotencyKey must be unique; MongoDB's unique index is non-sparse,
      // so omitting it would collide on the second null. We generate a fresh
      // UUID per request — same key the future "retry" deduper would consult.
      const created = await prisma.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: 'DEPOSIT',
          amount,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance, // unchanged until approved
          status: 'PENDING',
          slipUrl,
          idempotencyKey: crypto.randomUUID(),
          note: 'Deposit request — awaiting verification',
        },
      })
      notifyAdmin('transaction:created', toTxCreatedPayload(created, user))
      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/deposit]', err)
      const isConn =
        err instanceof Error &&
        /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
      return {
        op,
        error: isConn
          ? 'Cannot reach the database. Check your connection and try again.'
          : 'Failed to submit deposit. Please try again.',
      }
    }
  }

  if (op === 'withdraw') {
    const amount = parseInt(String(form.get('amount') ?? ''), 10)

    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return { op, error: `Minimum withdraw is ${MIN_WITHDRAW.toLocaleString()} ₭.` }
    }
    if (amount > MAX_WITHDRAW) {
      return { op, error: `Maximum withdraw is ${MAX_WITHDRAW.toLocaleString()} ₭.` }
    }

    try {
      const [wallet, bank] = await Promise.all([
        prisma.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: 'REAL' } },
        }),
        prisma.bank.findUnique({ where: { userId: user.id } }),
      ])
      if (!wallet) return { op, error: 'Real wallet not found.' }
      if (!bank) return { op, error: 'Add your bank QR code before withdrawing.' }
      if (amount > wallet.balance) {
        return { op, error: 'Withdraw exceeds your available balance.' }
      }

      // PENDING — admin debits the balance only on approval. We snapshot the
      // bank QR onto the transaction (slipUrl), so a later QR change leaves
      // older requests pointing at the QR that was current when submitted.
      const created = await prisma.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: 'WITHDRAW',
          amount,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance, // unchanged until approved
          status: 'PENDING',
          slipUrl: bank.qrUrl,
          idempotencyKey: crypto.randomUUID(),
          note: 'Withdraw request — awaiting verification',
        },
      })
      notifyAdmin('transaction:created', toTxCreatedPayload(created, user))
      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/withdraw]', err)
      const isConn =
        err instanceof Error &&
        /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
      return {
        op,
        error: isConn
          ? 'Cannot reach the database. Check your connection and try again.'
          : 'Failed to submit withdraw. Please try again.',
      }
    }
  }

  // ─── TRANSFER (general — instant) ───────────────────────────────────────
  if (op === 'transferGeneral') {
    const amount = parseInt(String(form.get('amount') ?? ''), 10)
    const recipientTel = String(form.get('recipientTel') ?? '').trim()

    if (!Number.isFinite(amount) || amount < MIN_TRANSFER) {
      return { op, error: `Minimum transfer is ${MIN_TRANSFER.toLocaleString()} ₭.` }
    }
    if (amount > MAX_TRANSFER) {
      return { op, error: `Maximum transfer is ${MAX_TRANSFER.toLocaleString()} ₭.` }
    }
    if (!recipientTel) return { op, error: 'Recipient phone is required.' }
    if (recipientTel === user.tel) return { op, error: "You can't transfer to yourself." }

    try {
      const recipient = await prisma.user.findUnique({ where: { tel: recipientTel } })
      if (!recipient) return { op, error: 'Recipient not found.' }
      if (recipient.status !== 'ACTIVE') return { op, error: "Recipient's account is not active." }

      const recvTx = await prisma.$transaction(async db => {
        const senderWallet = await db.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: 'REAL' } },
        })
        const recvWallet = await db.wallet.findUnique({
          where: { userId_type: { userId: recipient.id, type: 'REAL' } },
        })
        if (!senderWallet) throw new Error('Real wallet not found.')
        if (!recvWallet) throw new Error('Recipient real wallet not found.')
        if (senderWallet.balance < amount) throw new Error('Insufficient balance.')

        const senderAfter = senderWallet.balance - amount
        const recvAfter = recvWallet.balance + amount

        await db.wallet.update({
          where: { id: senderWallet.id },
          data: { balance: senderAfter, version: { increment: 1 } },
        })
        await db.wallet.update({
          where: { id: recvWallet.id },
          data: { balance: recvAfter, version: { increment: 1 } },
        })
        await db.transaction.create({
          data: {
            userId: user.id,
            walletId: senderWallet.id,
            type: 'TRANSFER_OUT',
            amount,
            balanceBefore: senderWallet.balance,
            balanceAfter: senderAfter,
            status: 'COMPLETED',
            targetUserId: recipient.id,
            idempotencyKey: crypto.randomUUID(),
            note: `Transfer to ${recipient.tel}`,
          },
        })
        return db.transaction.create({
          data: {
            userId: recipient.id,
            walletId: recvWallet.id,
            type: 'TRANSFER_IN',
            amount,
            balanceBefore: recvWallet.balance,
            balanceAfter: recvAfter,
            status: 'COMPLETED',
            targetUserId: user.id,
            idempotencyKey: crypto.randomUUID(),
            note: `Transfer from ${user.tel}`,
          },
        })
      })

      notifyUser(recipient.id, 'transaction:updated', {
        id: recvTx.id,
        status: 'COMPLETED',
        type: 'TRANSFER_IN',
        amount,
        balanceAfter: recvTx.balanceAfter,
        note: recvTx.note,
      })

      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/transferGeneral]', err)
      return { op, error: err instanceof Error ? err.message : 'Transfer failed.' }
    }
  }

  // ─── TRANSFER (locked — receiver claims by code) ────────────────────────
  if (op === 'transferLocked') {
    const amount = parseInt(String(form.get('amount') ?? ''), 10)
    const recipientTel = String(form.get('recipientTel') ?? '').trim()
    const code = String(form.get('code') ?? '').trim()

    if (!Number.isFinite(amount) || amount < MIN_TRANSFER) {
      return { op, error: `Minimum transfer is ${MIN_TRANSFER.toLocaleString()} ₭.` }
    }
    if (amount > MAX_TRANSFER) {
      return { op, error: `Maximum transfer is ${MAX_TRANSFER.toLocaleString()} ₭.` }
    }
    if (!recipientTel) return { op, error: 'Recipient phone is required.' }
    if (recipientTel === user.tel) return { op, error: "You can't transfer to yourself." }
    if (!/^\d{6}$/.test(code)) return { op, error: 'Code must be 6 digits.' }

    try {
      const recipient = await prisma.user.findUnique({ where: { tel: recipientTel } })
      if (!recipient) return { op, error: 'Recipient not found.' }
      if (recipient.status !== 'ACTIVE') return { op, error: "Recipient's account is not active." }

      const codeHash = await bcrypt.hash(code, 10)

      await prisma.$transaction(async db => {
        const senderWallet = await db.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: 'REAL' } },
        })
        if (!senderWallet) throw new Error('Real wallet not found.')
        if (senderWallet.balance < amount) throw new Error('Insufficient balance.')

        const senderAfter = senderWallet.balance - amount
        await db.wallet.update({
          where: { id: senderWallet.id },
          data: { balance: senderAfter, version: { increment: 1 } },
        })
        const transfer = await db.transfer.create({
          data: {
            senderId: user.id,
            receiverId: recipient.id,
            amount,
            codeHash,
            status: 'PENDING',
            note: `Locked transfer to ${recipient.tel}`,
          },
        })
        await db.transaction.create({
          data: {
            userId: user.id,
            walletId: senderWallet.id,
            type: 'TRANSFER_OUT',
            amount,
            balanceBefore: senderWallet.balance,
            balanceAfter: senderAfter,
            status: 'COMPLETED',
            targetUserId: recipient.id,
            idempotencyKey: crypto.randomUUID(),
            note: `Locked transfer #${transfer.id.slice(-6)} to ${recipient.tel}`,
          },
        })
      })

      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/transferLocked]', err)
      return { op, error: err instanceof Error ? err.message : 'Transfer failed.' }
    }
  }

  // ─── CLAIM a locked transfer (receiver enters the 6-digit code) ─────────
  if (op === 'claimTransfer') {
    const transferId = String(form.get('transferId') ?? '')
    const code = String(form.get('code') ?? '').trim()
    if (!transferId) return { op, error: 'transferId required.' }
    if (!/^\d{6}$/.test(code)) return { op, error: 'Code must be 6 digits.' }

    try {
      const transfer = await prisma.transfer.findUnique({ where: { id: transferId } })
      if (!transfer) return { op, error: 'Transfer not found.' }
      if (transfer.receiverId !== user.id) return { op, error: 'This transfer is not for you.' }
      if (transfer.status === 'COMPLETED') return { op, error: 'Already claimed.' }
      if (transfer.status === 'CANCELLED') return { op, error: 'Sender cancelled this transfer.' }
      if (transfer.status === 'LOCKED') return { op, error: 'Locked after too many wrong attempts. Ask the sender to cancel + resend.' }

      const ok = await bcrypt.compare(code, transfer.codeHash)
      if (!ok) {
        const nextAttempts = transfer.failedAttempts + 1
        const willLock = nextAttempts >= MAX_LOCK_ATTEMPTS
        await prisma.transfer.update({
          where: { id: transfer.id },
          data: {
            failedAttempts: nextAttempts,
            status: willLock ? 'LOCKED' : 'PENDING',
            lockedAt: willLock ? new Date() : null,
          },
        })
        return {
          op,
          error: willLock
            ? 'Too many wrong attempts. Transfer locked — ask the sender to cancel + resend.'
            : `Wrong code. ${MAX_LOCK_ATTEMPTS - nextAttempts} attempt(s) left.`,
        }
      }

      // Code matches — credit receiver and complete the transfer.
      await prisma.$transaction(async db => {
        const recvWallet = await db.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: 'REAL' } },
        })
        if (!recvWallet) throw new Error('Real wallet not found.')

        const newBalance = recvWallet.balance + transfer.amount

        await db.wallet.update({
          where: { id: recvWallet.id },
          data: { balance: newBalance, version: { increment: 1 } },
        })
        await db.transfer.update({
          where: { id: transfer.id },
          data: { status: 'COMPLETED', claimedAt: new Date() },
        })
        await db.transaction.create({
          data: {
            userId: user.id,
            walletId: recvWallet.id,
            type: 'TRANSFER_IN',
            amount: transfer.amount,
            balanceBefore: recvWallet.balance,
            balanceAfter: newBalance,
            status: 'COMPLETED',
            targetUserId: transfer.senderId,
            idempotencyKey: crypto.randomUUID(),
            note: `Locked transfer #${transfer.id.slice(-6)} claimed`,
          },
        })
      })

      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/claimTransfer]', err)
      return { op, error: err instanceof Error ? err.message : 'Claim failed.' }
    }
  }

  // ─── CANCEL a locked transfer (sender refunds before claim) ─────────────
  if (op === 'cancelTransfer') {
    const transferId = String(form.get('transferId') ?? '')
    if (!transferId) return { op, error: 'transferId required.' }

    try {
      const transfer = await prisma.transfer.findUnique({ where: { id: transferId } })
      if (!transfer) return { op, error: 'Transfer not found.' }
      if (transfer.senderId !== user.id) return { op, error: 'Only the sender can cancel.' }
      if (transfer.status === 'COMPLETED') return { op, error: 'Already claimed — too late to cancel.' }
      if (transfer.status === 'CANCELLED') return { op, error: 'Already cancelled.' }

      await prisma.$transaction(async db => {
        const senderWallet = await db.wallet.findUnique({
          where: { userId_type: { userId: user.id, type: 'REAL' } },
        })
        if (!senderWallet) throw new Error('Real wallet not found.')

        const refunded = senderWallet.balance + transfer.amount

        await db.wallet.update({
          where: { id: senderWallet.id },
          data: { balance: refunded, version: { increment: 1 } },
        })
        await db.transfer.update({
          where: { id: transfer.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        })
        await db.transaction.create({
          data: {
            userId: user.id,
            walletId: senderWallet.id,
            type: 'ADJUSTMENT',
            amount: transfer.amount,
            balanceBefore: senderWallet.balance,
            balanceAfter: refunded,
            status: 'COMPLETED',
            idempotencyKey: crypto.randomUUID(),
            note: `Locked transfer #${transfer.id.slice(-6)} cancelled — refund`,
          },
        })
      })

      return { op, ok: true }
    } catch (err) {
      console.error('[wallet/cancelTransfer]', err)
      return { op, error: err instanceof Error ? err.message : 'Cancel failed.' }
    }
  }

  return { op, error: 'This operation is not available yet.' }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const navigate = useNavigate()
  const loaderData = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const balanceHidden = useUIStore(s => s.balanceHidden)
  const toggleBalanceHidden = useUIStore(s => s.toggleBalanceHidden)
  const t = useT()

  // Realtime: when the admin approves/rejects a deposit/withdraw, or when
  // someone transfers to us, refresh the loader so the balance + tx rows
  // update without a manual refresh.
  usePusherEvent<TxUpdatedPayload>(
    userChannel(loaderData.me.id),
    'transaction:updated',
    payload => {
      const isCredit = payload.type === 'DEPOSIT' || payload.type === 'TRANSFER_IN'
      const sign = isCredit ? '+' : '-'
      const verbApproved = payload.type === 'DEPOSIT'
        ? t('wallet.toast.depositApproved')
        : payload.type === 'WITHDRAW'
          ? t('wallet.toast.withdrawApproved')
          : t('wallet.toast.transferReceived')
      const verbRejected = payload.type === 'DEPOSIT'
        ? t('wallet.toast.depositRejected')
        : t('wallet.toast.withdrawRejected')
      if (payload.status === 'COMPLETED') {
        toast.success(verbApproved, {
          description: `${sign}${payload.amount.toLocaleString()} ₭`,
        })
      } else {
        toast.error(verbRejected, {
          description: payload.note ?? t('wallet.toast.notApproved', { amount: payload.amount.toLocaleString() }),
        })
      }
      revalidator.revalidate()
    },
  )

  const [tab, setTab] = useState<Tab>('deposit')
  const [amount, setAmount] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [pendingDepositAmount, setPendingDepositAmount] = useState(0)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState(0)
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [pendingTransferAmount, setPendingTransferAmount] = useState(0)
  type ClaimTarget = { id: string; amount: number; sender: { tel: string; name: string | null } }
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ id: string; amount: number; receiver: { tel: string; name: string | null } } | null>(null)

  // Per-tab pagination — 20 initial, +20 per Load more click.
  const [visibleByTab, setVisibleByTab] = useState<Record<Tab, number>>({
    deposit: VISIBLE_INITIAL,
    withdraw: VISIBLE_INITIAL,
    transfer: VISIBLE_INITIAL,
  })

  const allTabTxs = useMemo(() => {
    if (tab === 'deposit') return loaderData.deposits
    if (tab === 'withdraw') return loaderData.withdraws
    return loaderData.transfers
  }, [tab, loaderData])

  const tabTxs = useMemo(
    () => allTabTxs.slice(0, visibleByTab[tab]),
    [allTabTxs, tab, visibleByTab],
  )
  const tabHasMore = visibleByTab[tab] < allTabTxs.length
  const tabRemaining = Math.max(0, allTabTxs.length - visibleByTab[tab])

  function loadMoreTab() {
    playClick()
    setVisibleByTab(prev => ({ ...prev, [tab]: prev[tab] + VISIBLE_STEP }))
  }

  const isRevalidating = navigation.state === 'loading'

  function showError(msg: string) {
    setInlineError(msg)
    setTimeout(() => setInlineError(null), 3500)
  }

  function openDeposit() {
    playClick()
    const val = parseInt(amount, 10)
    if (!val) return showError(t('wallet.errEnterAmount'))
    if (val < MIN_DEPOSIT) return showError(t('wallet.errMin', { amount: MIN_DEPOSIT.toLocaleString() }))
    if (val > MAX_DEPOSIT) return showError(t('wallet.errMax', { amount: MAX_DEPOSIT.toLocaleString() }))
    setPendingDepositAmount(val)
    setDepositModalOpen(true)
  }

  function openWithdraw() {
    playClick()
    const val = parseInt(amount, 10)
    if (!val) return showError(t('wallet.errEnterAmount'))
    if (val < MIN_WITHDRAW) return showError(t('wallet.errMin', { amount: MIN_WITHDRAW.toLocaleString() }))
    if (val > MAX_WITHDRAW) return showError(t('wallet.errMax', { amount: MAX_WITHDRAW.toLocaleString() }))
    if (val > loaderData.balance) return showError(t('wallet.errExceedsBalance'))
    setPendingWithdrawAmount(val)
    setWithdrawModalOpen(true)
  }

  function openTransfer() {
    playClick()
    const val = parseInt(amount, 10)
    if (!val) return showError(t('wallet.errEnterAmount'))
    if (val < MIN_TRANSFER) return showError(t('wallet.errMin', { amount: MIN_TRANSFER.toLocaleString() }))
    if (val > MAX_TRANSFER) return showError(t('wallet.errMax', { amount: MAX_TRANSFER.toLocaleString() }))
    if (val > loaderData.balance) return showError(t('wallet.errExceedsBalance'))
    setPendingTransferAmount(val)
    setTransferModalOpen(true)
  }

  // Toast when the deposit modal completes (it calls onSuccess before closing).
  const onDepositSuccess = () => {
    toast.success(t('deposit.submitted'), { description: t('deposit.submittedDesc') })
    setAmount('')
  }

  const onWithdrawSuccess = () => {
    toast.success(t('withdraw.submitted'), { description: t('withdraw.submittedDesc') })
    setAmount('')
  }

  const onTransferSuccess = () => {
    toast.success(t('transfer.submitted'), { description: t('transfer.submittedDesc') })
    setAmount('')
  }

  const onClaimSuccess = () => {
    toast.success(t('transfer.claimed'), { description: t('transfer.claimedDesc') })
  }

  const onCancelSuccess = () => {
    toast.success(t('transfer.cancelled'), { description: t('transfer.cancelledDesc') })
  }

  return (
    <div className="min-h-screen font-sans" style={{ background: '#7c3aed' }}>
      <header className="flex items-center gap-3 px-4 py-3" style={{ background: '#1e0040', borderBottom: '1px solid #a78bfa' }}>
        <button
          onClick={() => { playClick(); navigate('/') }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
        >
          <ArrowLeft size={16} />
          {t('common.back')}
        </button>
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: '#fde68a' }}>
          <WalletIcon size={20} /> {t('wallet.title')}
        </h1>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6 flex flex-col gap-6">
        {/* ─── Balance + totals card ────────────────────────────────────── */}
        <div
          className="relative rounded-2xl p-6"
          style={{ background: 'linear-gradient(135deg, #4c1d95, #1e0040)', border: '1px solid #a78bfa' }}
        >
          <button
            onClick={() => { playClick(); toggleBalanceHidden() }}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#4c1d95', border: '1px solid #7c3aed' }}
            title={balanceHidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
            aria-label={balanceHidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
          >
            {balanceHidden ? <EyeOff size={16} className="text-purple-300" /> : <Eye size={16} className="text-purple-300" />}
          </button>

          <div className="mb-1 text-center text-xs font-bold " style={{ color: '#c4b5fd' }}>
            {t('wallet.totalAvailable')}
          </div>
          <div className="mb-1 text-center text-4xl font-bold" style={{ color: '#fde68a' }}>
            {balanceHidden ? HIDDEN : loaderData.balance.toLocaleString()}
          </div>
          <div className="mb-4 text-center text-xs" style={{ color: '#a78bfa' }}>₭ ({t('wallet.realWallet')})</div>

          <div className="grid grid-cols-2 gap-3 border-t pt-4" style={{ borderColor: '#6d28d9' }}>
            <div className="text-center">
              <div className="text-[10px] font-bold " style={{ color: '#a78bfa' }}>{t('wallet.totalDeposit')}</div>
              <div className="mt-1 text-lg font-bold" style={{ color: '#4ade80' }}>
                {balanceHidden ? HIDDEN : `+${loaderData.totalDeposit.toLocaleString()}`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-bold " style={{ color: '#a78bfa' }}>{t('wallet.totalWithdraw')}</div>
              <div className="mt-1 text-lg font-bold" style={{ color: '#f87171' }}>
                {balanceHidden ? HIDDEN : `-${loaderData.totalWithdraw.toLocaleString()}`}
              </div>
            </div>
          </div>

          {/* PROMO wallet — read-only here. Bonus credit, only spendable via
              betting; the play page is where customers pick PROMO as the
              source wallet. */}
          {loaderData.promoBalance > 0 && (
            <div
              className="mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-xs"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px dashed #f59e0b' }}
            >
              <div className="flex flex-col">
                <span className="text-[10px] font-bold " style={{ color: '#fcd34d' }}>{t('wallet.promoWallet')}</span>
                <span className="text-[10px]" style={{ color: '#c4b5fd' }}>{t('wallet.promoNote')}</span>
              </div>
              <span className="text-base font-bold" style={{ color: '#fde68a' }}>
                {balanceHidden ? HIDDEN : `${loaderData.promoBalance.toLocaleString()} ₭`}
              </span>
            </div>
          )}
        </div>

        {inlineError && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-semibold text-center"
            style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
          >
            {inlineError}
          </div>
        )}

        {/* ─── Tabs ────────────────────────────────────────────────────── */}
        <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid #6d28d9' }}>
          {(['deposit', 'withdraw', 'transfer'] as Tab[]).map(tabKey => (
            <button
              key={tabKey}
              onClick={() => { playClick(); setTab(tabKey); setAmount('') }}
              className="flex-1 py-2.5 text-sm font-bold capitalize transition-all"
              style={{
                background: tab === tabKey ? '#7c3aed' : '#1e0040',
                color: tab === tabKey ? '#fff' : '#a78bfa',
              }}
            >
              {tabKey === 'deposit' ? t('wallet.tab.deposit') : tabKey === 'withdraw' ? t('wallet.tab.withdraw') : t('wallet.tab.transfer')}
            </button>
          ))}
        </div>

        {/* ─── Deposit form ────────────────────────────────────────────── */}
        {tab === 'deposit' && (
          <div className="flex flex-col gap-4">
            <QuickAmounts amounts={DEPOSIT_AMOUNTS} value={amount} onSelect={setAmount} />
            <CustomAmountInput value={amount} onChange={setAmount} />
            <button
              onClick={openDeposit}
              disabled={!amount}
              className="w-full rounded-xl py-4 text-base font-bold  transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                border: '2px solid #4ade80',
                boxShadow: '0 0 18px rgba(22,163,74,0.4)',
              }}
            >
              {t('wallet.depositCoins')}
            </button>
          </div>
        )}

        {/* ─── Withdraw form ────────────────────────────────────────── */}
        {tab === 'withdraw' && (
          <div className="flex flex-col gap-4">
            <QuickAmounts amounts={WITHDRAW_AMOUNTS} value={amount} onSelect={setAmount} />
            <CustomAmountInput value={amount} onChange={setAmount} />
            <button
              onClick={openWithdraw}
              disabled={!amount}
              className="w-full rounded-xl py-4 text-base font-bold  transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #b45309, #78350f)',
                color: '#fff',
                border: '2px solid #fcd34d',
                boxShadow: '0 0 18px rgba(180,83,9,0.4)',
              }}
            >
              {t('wallet.withdrawCoins')}
            </button>
          </div>
        )}

        {/* ─── Transfer form + pending lists ────────────────────────── */}
        {tab === 'transfer' && (
          <div className="flex flex-col gap-4">
            <QuickAmounts amounts={TRANSFER_AMOUNTS} value={amount} onSelect={setAmount} />
            <CustomAmountInput value={amount} onChange={setAmount} />
            <button
              onClick={openTransfer}
              disabled={!amount}
              className="w-full rounded-xl py-4 text-base font-bold  transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#fff',
                border: '2px solid #93c5fd',
                boxShadow: '0 0 18px rgba(37,99,235,0.4)',
              }}
            >
              {t('transfer.transferCoins')}
            </button>

            {/* Pending — to receive (locked transfers waiting for this user) */}
            <section className="mt-2">
              <div className="mb-2 text-sm font-bold " style={{ color: '#a78bfa' }}>
                {t('transfer.pendingReceived')}
              </div>
              {loaderData.pendingReceived.length === 0 ? (
                <p className="rounded-xl py-6 text-center text-xs" style={{ background: '#1e0040', color: '#7c3aed', border: '1px solid #4c1d95' }}>
                  {t('transfer.noPendingReceived')}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {loaderData.pendingReceived.map(p => (
                    <PendingReceivedRow key={p.id} p={p} onClaim={() => setClaimTarget({ id: p.id, amount: p.amount, sender: p.sender })} />
                  ))}
                </div>
              )}
            </section>

            {/* Pending — sent (locked transfers waiting for the receiver) */}
            {loaderData.pendingSent.length > 0 && (
              <section>
                <div className="mb-2 text-sm font-bold " style={{ color: '#a78bfa' }}>
                  {t('transfer.pendingSent')}
                </div>
                <div className="flex flex-col gap-2">
                  {loaderData.pendingSent.map(p => (
                    <PendingSentRow key={p.id} p={p} onCancel={() => setCancelTarget({ id: p.id, amount: p.amount, receiver: p.receiver })} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ─── Per-tab history ─────────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-bold " style={{ color: '#a78bfa' }}>
              {tab === 'deposit' ? t('wallet.history.deposit') : tab === 'withdraw' ? t('wallet.history.withdraw') : t('wallet.history.transfer')}
            </div>
            {isRevalidating && <Loader size={14} className="animate-spin" style={{ color: '#c4b5fd' }} />}
          </div>

          <div className="flex flex-col gap-2">
            {tabTxs.length === 0 && (
              <p className="rounded-xl py-8 text-center text-sm" style={{ background: '#1e0040', color: '#a78bfa', border: '1px solid #4c1d95' }}>
                {tab === 'deposit' ? t('wallet.noTx.deposit') : tab === 'withdraw' ? t('wallet.noTx.withdraw') : t('wallet.noTx.transfer')}
              </p>
            )}
            {tabTxs.map(tx => (
              <TxRow key={tx.id} tx={tx} />
            ))}
            {tabHasMore && (
              <button
                type="button"
                onClick={loadMoreTab}
                className="rounded-xl py-3 text-sm font-bold  transition-opacity hover:opacity-90"
                style={{ background: '#4c1d95', color: '#e9d5ff', border: '2px dashed #7c3aed' }}
              >
                {t('common.loadMoreCount', { n: Math.min(VISIBLE_STEP, tabRemaining) })}
              </button>
            )}
          </div>
        </section>
      </div>

      <DepositModal
        open={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        amount={pendingDepositAmount}
        onSuccess={onDepositSuccess}
      />
      <WithdrawModal
        open={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        amount={pendingWithdrawAmount}
        existingBankQrUrl={loaderData.bankQrUrl}
        onSuccess={onWithdrawSuccess}
      />
      <TransferModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        amount={pendingTransferAmount}
        senderTel={loaderData.me.tel}
        onSuccess={onTransferSuccess}
      />
      <ClaimTransferModal
        open={!!claimTarget}
        onClose={() => setClaimTarget(null)}
        transfer={claimTarget}
        onSuccess={onClaimSuccess}
      />
      {cancelTarget && (
        <ConfirmDialog
          open={!!cancelTarget}
          onClose={() => setCancelTarget(null)}
          title={t('transfer.cancelConfirmTitle')}
          description={t('transfer.cancelConfirmDesc', { amount: cancelTarget.amount.toLocaleString() })}
          tone="danger"
          confirmLabel={t('transfer.cancel')}
          fields={{ op: 'cancelTransfer', transferId: cancelTarget.id }}
          action="/wallet"
          onSettled={ok => { if (ok) onCancelSuccess() }}
        />
      )}
    </div>
  )
}

// ─── Pending transfer cards ──────────────────────────────────────────────────

type PendingReceived = ReturnType<typeof useLoaderData<typeof loader>>['pendingReceived'][number]
type PendingSent = ReturnType<typeof useLoaderData<typeof loader>>['pendingSent'][number]

function PendingReceivedRow({ p, onClaim }: { p: PendingReceived; onClaim: () => void }) {
  const t = useT()
  const isLocked = p.status === 'LOCKED'
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-3"
      style={{ background: '#1e0040', border: `1px solid ${isLocked ? '#f87171' : '#4c1d95'}` }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'linear-gradient(135deg, #f59e0b, #b45309)', color: '#1e0040' }}>
        {(p.sender.name?.split(' ').map(s => s[0]).join('').slice(0, 2) || p.sender.tel.slice(-2)).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold" style={{ color: '#fde68a' }}>
          {p.sender.name ?? p.sender.tel}
        </div>
        <div className="text-[10px]" style={{ color: '#a78bfa' }}>
          {p.sender.tel} · {new Date(p.createdAt).toLocaleString()}
        </div>
        {isLocked && (
          <div className="mt-0.5 text-[10px] font-bold" style={{ color: '#f87171' }}>
            {t('transfer.locked')}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-bold" style={{ color: '#4ade80' }}>+{p.amount.toLocaleString()}</span>
        <button
          type="button"
          onClick={onClaim}
          disabled={isLocked}
          className="rounded-md px-3 py-1 text-[10px] font-bold  disabled:opacity-40"
          style={{ background: '#16a34a', color: '#fff', border: '1px solid #4ade80' }}
        >
          {t('transfer.receive')}
        </button>
      </div>
    </div>
  )
}

function PendingSentRow({ p, onCancel }: { p: PendingSent; onCancel: () => void }) {
  const t = useT()
  const isLocked = p.status === 'LOCKED'
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-3"
      style={{ background: '#1e0040', border: `1px solid ${isLocked ? '#f87171' : '#4c1d95'}` }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: '#4c1d95', color: '#fde68a', border: '1px solid #7c3aed' }}>
        {(p.receiver.name?.split(' ').map(s => s[0]).join('').slice(0, 2) || p.receiver.tel.slice(-2)).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold" style={{ color: '#e9d5ff' }}>
          {p.receiver.name ?? p.receiver.tel}
        </div>
        <div className="text-[10px]" style={{ color: '#a78bfa' }}>
          {p.receiver.tel} · {new Date(p.createdAt).toLocaleString()}
        </div>
        {isLocked && (
          <div className="mt-0.5 text-[10px] font-bold" style={{ color: '#f87171' }}>
            {t('transfer.locked')}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-bold" style={{ color: '#f87171' }}>-{p.amount.toLocaleString()}</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-[10px] font-bold "
          style={{ background: '#7f1d1d', color: '#fff', border: '1px solid #fca5a5' }}
        >
          {t('transfer.cancel')}
        </button>
      </div>
    </div>
  )
}

// ─── Small presentational helpers ────────────────────────────────────────────

function QuickAmounts({ amounts, value, onSelect }: { amounts: number[]; value: string; onSelect: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {amounts.map(q => (
        <button
          key={q}
          onClick={() => { playClick(); onSelect(q.toString()) }}
          className="rounded-xl py-2.5 text-sm font-bold transition-all hover:opacity-90"
          style={{
            background: value === q.toString() ? '#7c3aed' : '#4c1d95',
            color: value === q.toString() ? '#fff' : '#c4b5fd',
            border: `1.5px solid ${value === q.toString() ? '#a78bfa' : '#6d28d9'}`,
          }}
        >
          {formatAmount(q)}
        </button>
      ))}
    </div>
  )
}

function CustomAmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // `value` is raw digits ("1000000"). Display it with thousand-separators
  // ("1,000,000"). On input, strip everything non-digit so the parent state
  // stays a plain integer string regardless of what the user typed.
  const t = useT()
  const display = value ? Number(value).toLocaleString() : ''
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: '#c4b5fd' }}>{t('wallet.customAmount')}</label>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder={t('wallet.enterAmount')}
        className="rounded-xl px-4 py-3 text-base font-semibold outline-none"
        style={{ background: '#1e0040', color: '#fde68a', border: '1.5px solid #6d28d9' }}
      />
    </div>
  )
}

type TxRowTx = Awaited<ReturnType<typeof loader>>['deposits'][number]

function TxRow({ tx }: { tx: TxRowTx }) {
  const t = useT()
  const isCredit = tx.type === 'DEPOSIT' || tx.type === 'TRANSFER_IN'
  const sign = isCredit ? '+' : '-'
  const amountColor = isCredit ? '#4ade80' : '#f87171'

  const statusStyle =
    tx.status === 'COMPLETED'
      ? { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' }
      : tx.status === 'PENDING'
        ? { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' }
        : { bg: 'rgba(220,38,38,0.2)', color: '#f87171' }

  const statusLabel =
    tx.status === 'COMPLETED' ? t('common.status.completed')
      : tx.status === 'PENDING' ? t('common.status.pending')
        : tx.status === 'CANCELLED' ? t('common.status.cancelled')
          : t('common.status.failed')

  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ background: '#1e0040', border: '1px solid #4c1d95' }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold capitalize" style={{ color: '#e9d5ff' }}>
          {tx.note ?? tx.type.replace('_', ' ').toLowerCase()}
        </span>
        <span className="text-xs" style={{ color: '#7c3aed' }}>{formatDate(tx.createdAt)}</span>
        {tx.slipUrl && (
          <a
            href={tx.slipUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-semibold underline"
            style={{ color: '#a78bfa' }}
          >
            {t('wallet.viewSlip')}
          </a>
        )}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-2">
        <span className="text-base font-bold" style={{ color: amountColor }}>
          {sign}{tx.amount.toLocaleString()}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: statusStyle.bg, color: statusStyle.color }}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  )
}
