import { useState } from 'react'
import { Form, useLoaderData, useNavigation, useRevalidator, useSearchParams, useSubmit } from 'react-router'
import { Loader, Lock, LockOpen, Search, ShieldOff, ShieldCheck as ShieldCheckIcon } from 'lucide-react'
import type { Route } from './+types/admin.customers'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL, type CustomerRegisteredPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { ConfirmDialog } from '~/components/ConfirmDialog'

const PAGE_SIZES = [10, 30, 50, 100, 200, 500] as const

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
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

  // Load all matching users, then sort by latest deposit/withdraw date.
  // Pagination is applied after sorting since MongoDB/Prisma can't ORDER BY
  // a related table's field natively.
  const [allUsers, latestTxs] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { wallets: true },
    }),
    prisma.transaction.groupBy({
      by: ['userId'],
      where: {
        type: { in: ['DEPOSIT', 'WITHDRAW'] },
        status: 'COMPLETED',
      },
      _max: { createdAt: true },
    }),
  ])

  const latestMap = new Map(latestTxs.map(t => [t.userId, t._max.createdAt as Date | null]))

  // Users with a deposit/withdraw come first (sorted by most recent), then the rest
  const sorted = [...allUsers].sort((a, b) => {
    const da = latestMap.get(a.id)
    const db = latestMap.get(b.id)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return db.getTime() - da.getTime()
  })

  const total = sorted.length
  const users = sorted.slice((page - 1) * pageSize, page * pageSize)

  return {
    q,
    page,
    total,
    pageSize,
    users: users.map(u => ({
      id: u.id,
      tel: u.tel,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      real: u.wallets.find(w => w.type === 'REAL')?.balance ?? 0,
      demo: u.wallets.find(w => w.type === 'DEMO')?.balance ?? 0,
      selfPlayPhase: u.selfPlayPhase,
      lastActivity: latestMap.get(u.id)?.toISOString() ?? null,
    })),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')
  const userId = String(fd.get('userId') ?? '')
  if (!userId) return { error: 'userId required' }

  if (op === 'suspend' || op === 'activate') {
    const nextStatus = op === 'suspend' ? 'SUSPENDED' : 'ACTIVE'
    await prisma.user.update({
      where: { id: userId },
      data: { status: nextStatus },
    })
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: op === 'suspend' ? 'user.suspend' : 'user.activate',
        target: `user:${userId}`,
      },
    })
    return { ok: true }
  }

  if (op === 'lockGame') {
    await prisma.user.update({
      where: { id: userId },
      data: { selfPlayPhase: 'ADMIN_LOCKED' },
    })
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'user.game_lock', target: `user:${userId}` },
    })
    return { ok: true }
  }

  if (op === 'unlockGame') {
    await prisma.user.update({
      where: { id: userId },
      data: { selfPlayPhase: 'NORMAL', selfPlayPhaseBalance: null },
    })
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'user.game_unlock', target: `user:${userId}` },
    })
    return { ok: true }
  }

  return { error: 'Unknown op' }
}

type CustomerRow = ReturnType<typeof useLoaderData<typeof loader>>['users'][number]

export default function AdminCustomers() {
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const submit = useSubmit()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  // Pending action target — populated when admin clicks suspend/activate;
  // cleared when the modal closes or the action settles.
  const [pending, setPending] = useState<CustomerRow | null>(null)

  // The toast for "new customer registered" is fired by the parent admin layout;
  // here we just refresh the list so the new row appears at the top.
  usePusherEvent<CustomerRegisteredPayload>(ADMIN_CHANNEL, 'customer:registered', () => {
    revalidator.revalidate()
  })

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
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Customers</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{data.total.toLocaleString()} total</span>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={data.pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          className="rounded-lg px-2 py-2 text-xs font-bold outline-none"
          style={{ background: '#0f172a', color: '#a5b4fc', border: '1.5px solid #4338ca' }}
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
        <Form method="get" className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#818cf8' }} />
            <input
              name="q"
              defaultValue={data.q}
              placeholder="Search by phone or name…"
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
        </Form>
      </div>

      {/* Mobile: cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {data.users.length === 0 && <EmptyState />}
        {data.users.map((u, i) => (
          <CustomerCard key={u.id} u={u} rowNum={(data.page - 1) * data.pageSize + i + 1} onAction={setPending} />
        ))}
      </div>

      {/* Desktop: table */}
      <div
        className="hidden overflow-x-auto rounded-xl md:block"
        style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
      >
        <table className="w-full text-left text-sm">
          <thead style={{ color: '#a5b4fc' }}>
            <tr className="text-[10px] font-bold " style={{ background: '#1e1b4b' }}>
              <th className="w-8 px-3 py-2 text-right" style={{ color: '#64748b' }}>#</th>
              <th className="px-3 py-2">PHONE</th>
              <th className="px-3 py-2">NAME</th>
              <th className="px-3 py-2 text-right">REAL</th>
              <th className="px-3 py-2 text-right">DEMO</th>
              <th className="px-3 py-2">STATUS</th>
              <th className="px-3 py-2">GAME TIER</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs" style={{ color: '#818cf8' }}>
                  No customers match.
                </td>
              </tr>
            )}
            {data.users.map((u, i) => (
              <tr key={u.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                <td className="px-3 py-2 text-right text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>{(data.page - 1) * data.pageSize + i + 1}</td>
                <td className="px-3 py-2 font-semibold">{u.tel}</td>
                <td className="px-3 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#a5b4fc' }}>{u.demo.toLocaleString()}</td>
                <td className="px-3 py-2"><StatusPill status={u.status} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <PhaseBadge phase={u.selfPlayPhase} />
                    <GameLockButton u={u} disabled={loading} onRevalidate={revalidator.revalidate} />
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <ActionButton u={u} onClick={() => setPending(u)} disabled={loading} />
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
              ← Prev
            </button>
            <button type="button" onClick={() => gotoPage(data.page + 1)}
              disabled={data.page >= totalPages || loading}
              className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
              Next →
            </button>
          </div>
          <span className="text-xs tabular-nums" style={{ color: '#a5b4fc' }}>
            Showing {Math.min((data.page - 1) * data.pageSize + 1, data.total)}–{Math.min(data.page * data.pageSize, data.total).toLocaleString()} of {data.total.toLocaleString()} customers · Page {data.page}/{totalPages}
          </span>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          open={!!pending}
          onClose={() => setPending(null)}
          title={pending.status === 'ACTIVE' ? 'Suspend this customer?' : 'Activate this customer?'}
          description={
            pending.status === 'ACTIVE'
              ? `${pending.tel} won't be able to sign in until reactivated.`
              : `${pending.tel} will regain access immediately.`
          }
          tone={pending.status === 'ACTIVE' ? 'danger' : 'success'}
          confirmLabel={pending.status === 'ACTIVE' ? 'SUSPEND' : 'ACTIVATE'}
          fields={{
            userId: pending.id,
            op: pending.status === 'ACTIVE' ? 'suspend' : 'activate',
          }}
        />
      )}
    </div>
  )
}

function CustomerCard({ u, onAction, rowNum }: { u: CustomerRow; onAction: (u: CustomerRow) => void; rowNum: number }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
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
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>REAL</div>
          <div className="font-semibold" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</div>
        </div>
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>DEMO</div>
          <div className="font-semibold" style={{ color: '#a5b4fc' }}>{u.demo.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PhaseBadge phase={u.selfPlayPhase} />
          <GameLockButton u={u} onRevalidate={() => window.location.reload()} />
        </div>
        <ActionButton u={u} onClick={() => onAction(u)} />
      </div>
    </div>
  )
}

function ActionButton({ u, onClick, disabled }: { u: CustomerRow; onClick: () => void; disabled?: boolean }) {
  const isActive = u.status === 'ACTIVE'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold  disabled:opacity-50"
      style={{
        background: isActive ? '#7f1d1d' : '#14532d',
        color: '#fff',
        border: `1px solid ${isActive ? '#fca5a5' : '#4ade80'}`,
      }}
    >
      {isActive ? <ShieldOff size={10} /> : <ShieldCheckIcon size={10} />}
      {isActive ? 'SUSPEND' : 'ACTIVATE'}
    </button>
  )
}

type SelfPlayPhase = CustomerRow['selfPlayPhase']

const PHASE_LABELS: Record<SelfPlayPhase, { label: string; bg: string; color: string }> = {
  NORMAL:       { label: 'Normal',   bg: 'rgba(22,163,74,0.15)',   color: '#4ade80' },
  PHASE_A:      { label: 'Phase A',  bg: 'rgba(234,88,12,0.2)',    color: '#fb923c' },
  PHASE_B:      { label: 'Phase B',  bg: 'rgba(202,138,4,0.2)',    color: '#facc15' },
  PHASE_C:      { label: 'Phase C',  bg: 'rgba(220,38,38,0.2)',    color: '#f87171' },
  ADMIN_LOCKED: { label: '🔒 Locked', bg: 'rgba(127,29,29,0.35)',  color: '#fca5a5' },
}

function PhaseBadge({ phase }: { phase: SelfPlayPhase }) {
  const p = PHASE_LABELS[phase]
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold whitespace-nowrap"
      style={{ background: p.bg, color: p.color, border: `1px solid ${p.color}40` }}>
      {p.label}
    </span>
  )
}

function GameLockButton({ u, disabled, onRevalidate }: { u: CustomerRow; disabled?: boolean; onRevalidate: () => void }) {
  const isLocked = u.selfPlayPhase === 'ADMIN_LOCKED'
  const submitHook = useSubmit()

  function toggle() {
    const fd = new FormData()
    fd.set('op', isLocked ? 'unlockGame' : 'lockGame')
    fd.set('userId', u.id)
    submitHook(fd, { method: 'post' })
    setTimeout(onRevalidate, 500)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={isLocked ? 'Unlock game (allow wins)' : 'Lock game (force losses)'}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50"
      style={{
        background: isLocked ? 'rgba(22,163,74,0.15)' : 'rgba(127,29,29,0.3)',
        color: isLocked ? '#4ade80' : '#fca5a5',
        border: `1px solid ${isLocked ? '#4ade8040' : '#fca5a540'}`,
      }}
    >
      {isLocked ? <LockOpen size={10} /> : <Lock size={10} />}
      {isLocked ? 'Unlock' : 'Lock'}
    </button>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-xl p-6 text-center text-xs"
      style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
    >
      No customers match.
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    ACTIVE: { bg: 'rgba(22,163,74,0.2)', color: '#4ade80' },
    SUSPENDED: { bg: 'rgba(234,179,8,0.2)', color: '#fde68a' },
    BANNED: { bg: 'rgba(220,38,38,0.2)', color: '#f87171' },
  }
  const s = map[status] ?? map.ACTIVE
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold "
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  )
}
