import { Form, redirect, useActionData, useNavigation } from 'react-router'
import { Loader, LogIn, ShieldCheck } from 'lucide-react'
import type { Route } from './+types/admin.login'
import { prisma } from '~/lib/prisma.server'
import { createAdminSession, getCurrentAdmin, verifyAdminPassword } from '~/lib/admin-auth.server'

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await getCurrentAdmin(request)
  if (admin) throw redirect('/admin')
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData()
  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const password = String(fd.get('password') ?? '')
  const next = String(fd.get('next') ?? '/admin') || '/admin'

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { email } })
    if (!admin) return { error: 'Invalid email or password.' }
    if (admin.status !== 'ACTIVE') return { error: 'Admin account is not active.' }

    const ok = await verifyAdminPassword(password, admin.passwordHash)
    if (!ok) return { error: 'Invalid email or password.' }

    return createAdminSession(admin.id, request, next)
  } catch (err) {
    console.error('[admin/login]', err)
    const isConn =
      err instanceof Error &&
      /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
    return {
      error: isConn
        ? 'Cannot reach the database. Try again in a moment.'
        : 'Something went wrong. Please try again.',
    }
  }
}

export default function AdminLoginPage() {
  const data = useActionData<typeof action>()
  const navigation = useNavigation()
  const submitting = navigation.state !== 'idle'

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 font-sans"
      style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'linear-gradient(135deg, #1e1b4b, #0f172a)', border: '1px solid #4338ca', boxShadow: '0 10px 60px rgba(0,0,0,0.7)' }}
      >
        <div className="mb-1 flex items-center justify-center gap-2 text-xs font-bold tracking-widest" style={{ color: '#a5b4fc' }}>
          <ShieldCheck size={14} /> ADMIN · SIGN IN
        </div>
        <h1 className="mb-5 text-center text-2xl font-bold" style={{ color: '#fde68a' }}>
          Pupatao Admin
        </h1>

        <Form method="post" className="flex flex-col gap-3">
          <label className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>Email</label>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="admin@pupatao.com"
            className="rounded-lg px-3 py-2.5 text-sm font-semibold outline-none"
            style={{ background: '#0f172a', color: '#fde68a', border: '1.5px solid #4338ca' }}
          />

          <label className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>Password</label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-lg px-3 py-2.5 text-sm font-semibold outline-none"
            style={{ background: '#0f172a', color: '#fde68a', border: '1.5px solid #4338ca' }}
          />

          {data?.error && (
            <div
              className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
            >
              {data.error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-widest disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #4338ca, #3730a3)',
              color: '#fff',
              border: '1.5px solid #818cf8',
            }}
          >
            {submitting ? <Loader size={16} className="animate-spin" /> : <LogIn size={16} />}
            {submitting ? 'Signing in…' : 'SIGN IN'}
          </button>
        </Form>
      </div>
    </div>
  )
}
