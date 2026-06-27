import { useState } from 'react'
import { Form, useFetcher, useLoaderData, useNavigation, useOutletContext, useRevalidator, useSearchParams, useSubmit } from 'react-router'
import { Ban, CircleSlash, Eye, EyeOff, KeyRound, Loader, Lock, LockOpen, Search, ShieldOff, ShieldCheck as ShieldCheckIcon, X } from 'lucide-react'
import type { Route } from './+types/admin.customers'
import { requireAdmin } from '~/lib/admin-auth.server'
import type { AdminOutletContext } from './admin'
import { prisma } from '~/lib/prisma.server'
import { ADMIN_CHANNEL, type CustomerRegisteredPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { useT } from '~/lib/use-t'
import { t as translate } from '~/lib/i18n'
import { parseLocaleCookie } from '~/lib/i18n'

const PAGE_SIZES = [10, 30, 50, 100, 200, 500] as const

// Lao mobile numbers are stored in several shapes:
//   +85620XXXXXXXX · 020XXXXXXXX · 20XXXXXXXX · XXXXXXXX (subscriber only)
// Normalise any of them to the digits-only international form WhatsApp expects
// (85620XXXXXXXX) so wa.me opens the correct chat.
function toWhatsappPhone(raw: string): string {
  const d = raw.replace(/\D/g, '') // strip +, spaces, dashes → digits only
  if (d.startsWith('856')) return d                 // already has country code
  if (d.startsWith('0')) return '856' + d.slice(1)  // 020XXXXXXXX → 85620XXXXXXXX
  if (d.startsWith('20')) return '856' + d          // 20XXXXXXXX  → 85620XXXXXXXX
  return '85620' + d                                 // bare subscriber → 85620XXXXXXXX
}
function whatsappLink(raw: string): string {
  return `https://wa.me/${toWhatsappPhone(raw)}`
}

const PHASE_VALUES = ['NORMAL', 'PHASE_A', 'PHASE_B', 'PHASE_C', 'ADMIN_LOCKED'] as const
type PhaseFilter = 'ALL' | typeof PHASE_VALUES[number]
type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '30', 10)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : 30
  const phaseParam = url.searchParams.get('phase') ?? 'ALL'
  const phase: PhaseFilter = (PHASE_VALUES as readonly string[]).includes(phaseParam) ? phaseParam as PhaseFilter : 'ALL'
  const statusParam = url.searchParams.get('status') ?? 'ALL'
  const statusFilter: StatusFilter = statusParam === 'ACTIVE' ? 'ACTIVE' : statusParam === 'SUSPENDED' ? 'SUSPENDED' : 'ALL'

  const where = {
    ...(q ? {
      OR: [
        { tel: { contains: q, mode: 'insensitive' as const } },
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
      ],
    } : {}),
    ...(phase !== 'ALL' ? { selfPlayPhase: phase } : {}),
    ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
  }

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
    phase,
    statusFilter,
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
      betLocked: u.betLocked,
      lastActivity: latestMap.get(u.id)?.toISOString() ?? null,
    })),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  // Errors are translated server-side from the locale cookie so render sites
  // can show `data.error` verbatim (actions can't call the useT() hook).
  const locale = parseLocaleCookie(request.headers.get('cookie'))
  // SUPPORT role cannot perform mutations on customers
  if (admin.role === 'SUPPORT') return { error: translate(locale, 'admin.customers.err.insufficientPermissions') }
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')
  const userId = String(fd.get('userId') ?? '')
  if (!userId) return { error: translate(locale, 'admin.customers.err.userIdRequired') }

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

  if (op === 'betLock' || op === 'betUnlock') {
    await prisma.user.update({
      where: { id: userId },
      data: { betLocked: op === 'betLock' },
    })
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: op === 'betLock' ? 'user.bet_lock' : 'user.bet_unlock', target: `user:${userId}` },
    })
    return { ok: true }
  }

  if (op === 'resetPassword') {
    const newPassword = String(fd.get('newPassword') ?? '').trim()
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: translate(locale, 'admin.customers.err.passwordMinLength') }
    }
    const { hashPassword } = await import('~/lib/auth.server')
    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'user.password_reset', target: `user:${userId}` },
    })
    return { ok: true, op: 'resetPassword' }
  }

  return { error: translate(locale, 'admin.customers.err.unknownOp') }
}

type CustomerRow = ReturnType<typeof useLoaderData<typeof loader>>['users'][number]

export default function AdminCustomers() {
  const t = useT()
  const data = useLoaderData<typeof loader>()
  const { adminRole } = useOutletContext<AdminOutletContext>()
  const isSupport = adminRole === 'SUPPORT'
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const submit = useSubmit()
  const revalidator = useRevalidator()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  // Pending action target — populated when admin clicks suspend/activate;
  // cleared when the modal closes or the action settles.
  const [pending, setPending] = useState<CustomerRow | null>(null)
  const [passwordModal, setPasswordModal] = useState<CustomerRow | null>(null)

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

  function setPhase(p: PhaseFilter) {
    const next = new URLSearchParams(params)
    if (p === 'ALL') next.delete('phase')
    else next.set('phase', p)
    next.delete('page')
    submit(next, { method: 'get' })
  }

  function setStatus(s: StatusFilter) {
    const next = new URLSearchParams(params)
    if (s === 'ALL') next.delete('status')
    else next.set('status', s)
    next.delete('page')
    submit(next, { method: 'get' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('admin.customers.title')}</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{t('admin.customers.total', { count: data.total.toLocaleString() })}</span>
      </div>

      {/* Phase + Status filter pills — same row, phase left / status right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: 'ALL',          label: t('admin.customers.filter.all'),   color: '#a5b4fc' },
            { key: 'NORMAL',       label: 'NORMAL',   color: '#4ade80' },
            { key: 'PHASE_A',      label: 'PHASE_A',  color: '#fbbf24' },
            { key: 'PHASE_B',      label: 'PHASE_B',  color: '#fb923c' },
            { key: 'PHASE_C',      label: 'PHASE_C',  color: '#f87171' },
            { key: 'ADMIN_LOCKED', label: 'LOCKED',   color: '#fca5a5' },
          ] as { key: PhaseFilter; label: string; color: string }[]).map(({ key, label, color }) => {
            const active = data.phase === key
            return (
              <button key={key} type="button" onClick={() => setPhase(key)}
                className="rounded-md px-3 py-1 text-xs font-bold"
                style={{
                  background: active ? 'rgba(30,27,75,1)' : 'transparent',
                  color: active ? color : '#818cf8',
                  border: `1px solid ${active ? '#4338ca' : '#1e1b4b'}`,
                }}>
                {label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-1.5">
          {([
            { key: 'ALL',       label: t('admin.customers.filter.all'),     color: '#a5b4fc' },
            { key: 'ACTIVE',    label: 'ACTIVE',    color: '#4ade80' },
            { key: 'SUSPENDED', label: 'SUSPENDED', color: '#fde68a' },
          ] as { key: StatusFilter; label: string; color: string }[]).map(({ key, label, color }) => {
            const active = data.statusFilter === key
            return (
              <button key={key} type="button" onClick={() => setStatus(key)}
                className="rounded-md px-3 py-1 text-xs font-bold"
                style={{
                  background: active ? 'rgba(30,27,75,1)' : 'transparent',
                  color: active ? color : '#818cf8',
                  border: `1px solid ${active ? '#4338ca' : '#1e1b4b'}`,
                }}>
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={data.pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          className="rounded-lg px-2 py-2 text-xs font-bold outline-none"
          style={{ background: '#0f172a', color: '#a5b4fc', border: '1.5px solid #4338ca' }}
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{t('admin.customers.pageSizeOption', { size: s })}</option>)}
        </select>
        <Form method="get" className="flex flex-1 items-center gap-2">
          <input type="hidden" name="phase"  value={data.phase === 'ALL' ? '' : data.phase} />
          <input type="hidden" name="status" value={data.statusFilter === 'ALL' ? '' : data.statusFilter} />
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#818cf8' }} />
            <input
              name="q"
              defaultValue={data.q}
              placeholder={t('admin.customers.search.placeholder')}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none"
              style={{ background: '#0f172a', color: '#fde68a', border: '1.5px solid #4338ca' }}
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-xs font-bold"
            style={{ background: '#4338ca', color: '#fff', border: '1.5px solid #818cf8' }}
          >
            {loading ? <Loader size={14} className="animate-spin" /> : t('admin.customers.search.button')}
          </button>
        </Form>
      </div>

      {/* Mobile: cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {data.users.length === 0 && <EmptyState />}
        {data.users.map((u, i) => (
          <CustomerCard key={u.id} u={u} rowNum={(data.page - 1) * data.pageSize + i + 1} onAction={isSupport ? undefined : setPending} onResetPassword={isSupport ? undefined : setPasswordModal} />
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
              <th className="px-3 py-2">{t('admin.customers.table.phone')}</th>
              <th className="px-3 py-2">{t('admin.customers.table.name')}</th>
              <th className="px-3 py-2 text-right">REAL</th>
              <th className="px-3 py-2">{t('admin.customers.table.status')}</th>
              <th className="px-3 py-2">{t('admin.customers.table.gameTier')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs" style={{ color: '#818cf8' }}>
                  {t('admin.customers.table.noMatch')}
                </td>
              </tr>
            )}
            {data.users.map((u, i) => (
              <tr key={u.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                <td className="px-3 py-2 text-right text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>{(data.page - 1) * data.pageSize + i + 1}</td>
                <td className="px-3 py-2 font-semibold">
                  <a href={whatsappLink(u.tel)} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: '#34d399' }} title="WhatsApp">{u.tel}</a>
                </td>
                <td className="px-3 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</td>
                <td className="px-3 py-2"><StatusPill status={u.status} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <PhaseBadge phase={u.selfPlayPhase} />
                    {!isSupport && <GameLockButton u={u} disabled={loading} onRevalidate={revalidator.revalidate} />}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {!isSupport && (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        title={t('admin.customers.action.resetPasswordTitle')}
                        onClick={() => setPasswordModal(u)}
                        disabled={loading}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50"
                        style={{ background: 'rgba(67,56,202,0.25)', color: '#a5b4fc', border: '1px solid #4338ca' }}
                      >
                        <KeyRound size={10} /> {t('admin.customers.action.pwShort')}
                      </button>
                      <BetLockButton u={u} disabled={loading} onRevalidate={revalidator.revalidate} />
                      <ActionButton u={u} onClick={() => setPending(u)} disabled={loading} />
                    </div>
                  )}
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
              {t('admin.customers.page.prev')}
            </button>
            <button type="button" onClick={() => gotoPage(data.page + 1)}
              disabled={data.page >= totalPages || loading}
              className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
              {t('admin.customers.page.next')}
            </button>
          </div>
          <span className="text-xs tabular-nums" style={{ color: '#a5b4fc' }}>
            {t('admin.customers.page.showing', {
              from: Math.min((data.page - 1) * data.pageSize + 1, data.total),
              to: Math.min(data.page * data.pageSize, data.total).toLocaleString(),
              total: data.total.toLocaleString(),
              page: data.page,
              totalPages,
            })}
          </span>
        </div>
      )}

      {passwordModal && (
        <ResetPasswordModal user={passwordModal} onClose={() => setPasswordModal(null)} />
      )}

      {pending && (
        <ConfirmDialog
          open={!!pending}
          onClose={() => setPending(null)}
          title={pending.status === 'ACTIVE' ? t('admin.customers.confirm.suspendTitle') : t('admin.customers.confirm.activateTitle')}
          description={
            pending.status === 'ACTIVE'
              ? t('admin.customers.confirm.suspendDescription', { tel: pending.tel })
              : t('admin.customers.confirm.activateDescription', { tel: pending.tel })
          }
          tone={pending.status === 'ACTIVE' ? 'danger' : 'success'}
          confirmLabel={pending.status === 'ACTIVE' ? t('admin.customers.action.suspend') : t('admin.customers.action.activate')}
          fields={{
            userId: pending.id,
            op: pending.status === 'ACTIVE' ? 'suspend' : 'activate',
          }}
        />
      )}
    </div>
  )
}

function CustomerCard({ u, onAction, onResetPassword, rowNum }: { u: CustomerRow; onAction?: (u: CustomerRow) => void; onResetPassword?: (u: CustomerRow) => void; rowNum: number }) {
  const t = useT()
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: '#64748b' }}>#{rowNum}</span>
            <a href={whatsappLink(u.tel)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline" style={{ color: '#34d399' }} title="WhatsApp">{u.tel}</a>
          </div>
          <div className="truncate text-xs" style={{ color: '#e9d5ff' }}>
            {[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}
          </div>
        </div>
        <StatusPill status={u.status} />
      </div>
      <div className="mt-2 text-xs">
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold " style={{ color: '#a5b4fc' }}>REAL</div>
          <div className="font-semibold" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PhaseBadge phase={u.selfPlayPhase} />
          {onAction && <GameLockButton u={u} onRevalidate={() => window.location.reload()} />}
        </div>
        {(onResetPassword || onAction) && (
        <div className="flex items-center gap-1.5">
          {onResetPassword && <button
            type="button"
            onClick={() => onResetPassword(u)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold"
            style={{ background: 'rgba(67,56,202,0.25)', color: '#a5b4fc', border: '1px solid #4338ca' }}
          >
            <KeyRound size={10} /> {t('admin.customers.action.pwShort')}
          </button>}
          {onAction && <BetLockButton u={u} onRevalidate={() => window.location.reload()} />}
          {onAction && <ActionButton u={u} onClick={() => onAction(u)} />}
        </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({ u, onClick, disabled }: { u: CustomerRow; onClick: () => void; disabled?: boolean }) {
  const t = useT()
  const isActive = u.status === 'ACTIVE'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold  disabled:opacity-50"
      style={{
        background: isActive ? '#7f1d1d' : '#14532d',
        color: '#fff',
        border: `1px solid ${isActive ? '#fca5a5' : '#4ade80'}`,
      }}
    >
      {isActive ? <ShieldOff size={10} /> : <ShieldCheckIcon size={10} />}
      {isActive ? t('admin.customers.action.suspendShort') : t('admin.customers.action.activateShort')}
    </button>
  )
}

type SelfPlayPhase = CustomerRow['selfPlayPhase']

// NORMAL/PHASE_* keep their raw enum names (DB values); only ADMIN_LOCKED shows
// a translated display label, resolved in PhaseBadge.
const PHASE_LABELS: Record<SelfPlayPhase, { label: string; bg: string; color: string }> = {
  NORMAL:       { label: 'NORMAL',   bg: 'rgba(22,163,74,0.15)',   color: '#4ade80' },
  PHASE_A:      { label: 'PHASE_A',  bg: 'rgba(234,88,12,0.2)',    color: '#fb923c' },
  PHASE_B:      { label: 'PHASE_B',  bg: 'rgba(202,138,4,0.2)',    color: '#facc15' },
  PHASE_C:      { label: 'PHASE_C',  bg: 'rgba(220,38,38,0.2)',    color: '#f87171' },
  ADMIN_LOCKED: { label: 'ADMIN_LOCKED', bg: 'rgba(127,29,29,0.35)',  color: '#fca5a5' },
}

function PhaseBadge({ phase }: { phase: SelfPlayPhase }) {
  const t = useT()
  const p = PHASE_LABELS[phase]
  const label = phase === 'ADMIN_LOCKED' ? t('admin.customers.lock.adminLockedLabel') : p.label
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold whitespace-nowrap"
      style={{ background: p.bg, color: p.color, border: `1px solid ${p.color}40` }}>
      {label}
    </span>
  )
}

function GameLockButton({ u, disabled, onRevalidate }: { u: CustomerRow; disabled?: boolean; onRevalidate: () => void }) {
  const t = useT()
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
      title={isLocked ? t('admin.customers.lock.unlockTitle') : t('admin.customers.lock.lockTitle')}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50"
      style={{
        background: isLocked ? 'rgba(22,163,74,0.15)' : 'rgba(127,29,29,0.3)',
        color: isLocked ? '#4ade80' : '#fca5a5',
        border: `1px solid ${isLocked ? '#4ade8040' : '#fca5a540'}`,
      }}
    >
      {isLocked ? <LockOpen size={10} /> : <Lock size={10} />}
      {isLocked ? t('admin.customers.lock.unlock') : t('admin.customers.lock.lock')}
    </button>
  )
}

// Bet-lock: hides the LIVE betting board from this user entirely — they can
// watch a round but can't bet, even when the admin opens a new round.
function BetLockButton({ u, disabled, onRevalidate }: { u: CustomerRow; disabled?: boolean; onRevalidate: () => void }) {
  const t = useT()
  const isBetLocked = u.betLocked
  const submitHook = useSubmit()

  function toggle() {
    const fd = new FormData()
    fd.set('op', isBetLocked ? 'betUnlock' : 'betLock')
    fd.set('userId', u.id)
    submitHook(fd, { method: 'post' })
    setTimeout(onRevalidate, 500)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={isBetLocked ? t('admin.customers.betLock.unlockTitle') : t('admin.customers.betLock.lockTitle')}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50"
      style={{
        background: isBetLocked ? 'rgba(217,119,6,0.25)' : 'rgba(67,56,202,0.2)',
        color: isBetLocked ? '#fbbf24' : '#a5b4fc',
        border: `1px solid ${isBetLocked ? '#d97706' : '#4338ca'}`,
      }}
    >
      {isBetLocked ? <CircleSlash size={10} /> : <Ban size={10} />}
      {isBetLocked ? t('admin.customers.betLock.unlock') : t('admin.customers.betLock.lock')}
    </button>
  )
}

function ResetPasswordModal({ user, onClose }: { user: CustomerRow; onClose: () => void }) {
  const t = useT()
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const submitting = fetcher.state !== 'idle'
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.tel

  // Close + show toast on success
  const prevData = useState<typeof fetcher.data>(undefined)
  if (fetcher.state === 'idle' && fetcher.data?.ok && prevData[0] !== fetcher.data) {
    prevData[1](fetcher.data)
    // Defer to avoid calling setState during render
    setTimeout(() => onClose(), 0)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: '#0f172a', border: '2px solid #4338ca' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#fde68a' }}>
              <KeyRound size={14} /> {t('admin.customers.action.resetPasswordTitle')}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: '#a5b4fc' }}>{name} · {user.tel}</div>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
            <X size={14} />
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="op" value="resetPassword" />
          <input type="hidden" name="userId" value={user.id} />

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.customers.resetPassword.newPasswordLabel')}</label>
            <div className="relative">
              <input
                name="newPassword"
                type={show ? 'text' : 'password'}
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder={t('admin.customers.resetPassword.placeholder')}
                autoComplete="new-password"
                className="w-full rounded-lg px-3 py-2.5 pr-10 text-sm outline-none"
                style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: '#818cf8' }}
                tabIndex={-1}
              >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {fetcher.data?.error && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid #f87171' }}>
              {fetcher.data.error}
            </div>
          )}
          {fetcher.data?.ok && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid #4ade80' }}>
              {t('admin.customers.resetPassword.success')}
            </div>
          )}

          <div className="mt-1 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
              {t('admin.customers.resetPassword.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || pw.length < 6}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#4338ca,#312e81)', color: '#fff', border: '1px solid #818cf8' }}
            >
              {submitting ? <Loader size={14} className="animate-spin" /> : <KeyRound size={14} />}
              {submitting ? t('admin.customers.resetPassword.saving') : t('admin.customers.resetPassword.submit')}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  )
}

function EmptyState() {
  const t = useT()
  return (
    <div
      className="rounded-xl p-6 text-center text-xs"
      style={{ background: '#0f172a', color: '#818cf8', border: '1px solid #1e1b4b' }}
    >
      {t('admin.customers.table.noMatch')}
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
