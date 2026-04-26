import { Form, NavLink, Outlet, useLoaderData } from 'react-router'
import { Banknote, Dices, LayoutDashboard, LogOut, Radio, ShieldCheck, Users } from 'lucide-react'
import type { Route } from './+types/admin'
import { requireAdmin } from '~/lib/admin-auth.server'

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request)
  return {
    admin: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    },
  }
}

const NAV: { to: string; end?: boolean; label: string; mobileLabel?: string; Icon: typeof LayoutDashboard }[] = [
  { to: '/admin', end: true, label: 'Dashboard', mobileLabel: 'Home', Icon: LayoutDashboard },
  { to: '/admin/customers', label: 'Customers', Icon: Users },
  { to: '/admin/transactions', label: 'Transactions', Icon: Banknote },
  { to: '/admin/play-history', label: 'Play History', mobileLabel: 'Plays', Icon: Dices },
  { to: '/admin/live', label: 'Live Play', mobileLabel: 'Live', Icon: Radio },
]

export default function AdminLayout() {
  const { admin } = useLoaderData<typeof loader>()
  const fullName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email

  return (
    <div
      className="min-h-screen font-sans"
      style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 60%, #0f172a 100%)' }}
    >
      <header style={{ background: '#0f172a', borderBottom: '1px solid #4338ca' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: '#a5b4fc' }} />
            <span className="text-sm font-bold tracking-widest" style={{ color: '#fde68a' }}>
              PUPATAO · ADMIN
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col text-right sm:flex">
              <span className="text-xs font-semibold" style={{ color: '#e9d5ff' }}>{fullName}</span>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a5b4fc' }}>{admin.role}</span>
            </div>
            <Form method="post" action="/admin/logout">
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
                style={{ background: '#1e1b4b', color: '#e9d5ff', border: '1px solid #4338ca' }}
              >
                <LogOut size={12} />
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        {/* Sidebar — vertical on md+, hidden on mobile (replaced by fixed bottom bar) */}
        <aside className="hidden md:block md:w-56 md:shrink-0">
          <nav
            className="flex flex-col gap-1 rounded-xl p-2"
            style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}
          >
            {NAV.map(({ to, end, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => [
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'border' : 'hover:opacity-80',
                ].join(' ')}
                style={({ isActive }) => ({
                  background: isActive ? '#1e1b4b' : 'transparent',
                  color: isActive ? '#fde68a' : '#a5b4fc',
                  borderColor: isActive ? '#4338ca' : 'transparent',
                })}
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* pb-24 on mobile leaves room for the fixed bottom bar */}
        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom bar — icon + label, equal-width buckets */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex md:hidden"
        style={{
          background: '#0f172a',
          borderTop: '1px solid #4338ca',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map(({ to, end, label, mobileLabel, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold tracking-wide"
            style={({ isActive }) => ({
              color: isActive ? '#fde68a' : '#a5b4fc',
              background: isActive ? '#1e1b4b' : 'transparent',
            })}
          >
            <Icon size={18} />
            <span>{mobileLabel ?? label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
