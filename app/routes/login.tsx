import { useState } from 'react'
import { redirect, useNavigate, useSearchParams } from 'react-router'
import type { Route } from './+types/login'
import { prisma } from '~/lib/prisma.server'
import { createUserSession, getCurrentUser, verifyPassword } from '~/lib/auth.server'
import { LoginModal } from '~/components/LoginModal'
import { RegisterModal } from '~/components/RegisterModal'

export async function loader({ request }: Route.LoaderArgs) {
  // If already authenticated, bounce to the game.
  const user = await getCurrentUser(request)
  if (user) throw redirect('/')
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const tel = String(formData.get('tel') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/') || '/'

  if (!tel || !password) {
    return { error: 'Phone number and password are required.' }
  }

  try {
    const user = await prisma.user.findUnique({ where: { tel } })
    if (!user) return { error: 'Invalid phone number or password.' }
    if (user.status !== 'ACTIVE') return { error: 'Account is not active. Contact support.' }

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) return { error: 'Invalid phone number or password.' }

    return createUserSession(user.id, request, next)
  } catch (err) {
    console.error('[login]', err)
    const isConn =
      err instanceof Error &&
      /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
    return {
      error: isConn
        ? 'Cannot reach the database. Check your internet connection and that your IP is allowed in MongoDB Atlas, then try again.'
        : 'Something went wrong. Please try again in a moment.',
    }
  }
}

// Direct visits to /login (e.g. protected-route redirects with ?next=…) still
// land here. The page renders the home gradient with the modal overlaid,
// so users always see the same "modal on top of the app" experience.
export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [showRegister, setShowRegister] = useState(false)

  return (
    <div
      className="min-h-screen font-sans"
      style={{
        background: 'linear-gradient(160deg, #3b0764 0%, #5b21b6 35%, #7c3aed 65%, #4c1d95 100%)',
      }}
    >
      <LoginModal
        open={!showRegister}
        next={next}
        onClose={() => navigate('/')}
        onSwitchToRegister={() => setShowRegister(true)}
      />
      <RegisterModal
        open={showRegister}
        next={next}
        onClose={() => navigate('/')}
        onSwitchToLogin={() => setShowRegister(false)}
      />
    </div>
  )
}
