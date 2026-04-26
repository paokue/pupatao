import { useState } from 'react'
import { Form, useLoaderData, useNavigation, useSearchParams, useSubmit } from 'react-router'
import { Loader, Search, ShieldOff, ShieldCheck as ShieldCheckIcon } from 'lucide-react'
import type { Route } from './+types/admin.customers'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import { ConfirmDialog } from '~/components/ConfirmDialog'

const PAGE_SIZE = 20

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)

  const where = q
    ? {
        OR: [
          { tel: { contains: q, mode: 'insensitive' as const } },
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        wallets: true,
      },
    }),
  ])

  return {
    q,
    page,
    total,
    pageSize: PAGE_SIZE,
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

  return { error: 'Unknown op' }
}

type CustomerRow = ReturnType<typeof useLoaderData<typeof loader>>['users'][number]

export default function AdminCustomers() {
  const data = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const submit = useSubmit()
  const loading = navigation.state !== 'idle'
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  // Pending action target — populated when admin clicks suspend/activate;
  // cleared when the modal closes or the action settles.
  const [pending, setPending] = useState<CustomerRow | null>(null)

  function gotoPage(n: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(n))
    submit(next, { method: 'get' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>Customers</h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{data.total.toLocaleString()} total</span>
      </div>

      <Form method="get" className="flex items-center gap-2">
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
          className="rounded-lg px-3 py-2 text-xs font-bold tracking-widest"
          style={{ background: '#4338ca', color: '#fff', border: '1.5px solid #818cf8' }}
        >
          {loading ? <Loader size={14} className="animate-spin" /> : 'SEARCH'}
        </button>
      </Form>

      {/* Mobile: cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {data.users.length === 0 && <EmptyState />}
        {data.users.map(u => (
          <CustomerCard key={u.id} u={u} onAction={setPending} />
        ))}
      </div>

      {/* Desktop: table */}
      <div
        className="hidden overflow-x-auto rounded-xl md:block"
        style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
      >
        <table className="w-full text-left text-sm">
          <thead style={{ color: '#a5b4fc' }}>
            <tr className="text-[10px] font-bold tracking-widest" style={{ background: '#1e1b4b' }}>
              <th className="px-3 py-2">PHONE</th>
              <th className="px-3 py-2">NAME</th>
              <th className="px-3 py-2 text-right">REAL</th>
              <th className="px-3 py-2 text-right">DEMO</th>
              <th className="px-3 py-2">STATUS</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs" style={{ color: '#818cf8' }}>
                  No customers match.
                </td>
              </tr>
            )}
            {data.users.map(u => (
              <tr key={u.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                <td className="px-3 py-2 font-semibold">{u.tel}</td>
                <td className="px-3 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#a5b4fc' }}>{u.demo.toLocaleString()}</td>
                <td className="px-3 py-2"><StatusPill status={u.status} /></td>
                <td className="px-3 py-2 text-right">
                  <ActionButton u={u} onClick={() => setPending(u)} disabled={loading} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => gotoPage(data.page - 1)}
            disabled={data.page <= 1 || loading}
            className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
          >
            ← Prev
          </button>
          <span className="text-xs" style={{ color: '#a5b4fc' }}>
            Page {data.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => gotoPage(data.page + 1)}
            disabled={data.page >= totalPages || loading}
            className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-30"
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}
          >
            Next →
          </button>
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

function CustomerCard({ u, onAction }: { u: CustomerRow; onAction: (u: CustomerRow) => void }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: '#fde68a' }}>{u.tel}</div>
          <div className="truncate text-xs" style={{ color: '#e9d5ff' }}>
            {[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>—</span>}
          </div>
        </div>
        <StatusPill status={u.status} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>REAL</div>
          <div className="font-semibold" style={{ color: '#fde68a' }}>{u.real.toLocaleString()}</div>
        </div>
        <div className="rounded-md px-2 py-1.5" style={{ background: '#1e1b4b' }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>DEMO</div>
          <div className="font-semibold" style={{ color: '#a5b4fc' }}>{u.demo.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
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
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold tracking-widest disabled:opacity-50"
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
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  )
}
