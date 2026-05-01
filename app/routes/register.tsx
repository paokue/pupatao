import { useState } from 'react'
import { redirect, useNavigate, useSearchParams } from 'react-router'
import type { Route } from './+types/register'
import { prisma } from '~/lib/prisma.server'
import { createUserSession, getCurrentUser, hashPassword } from '~/lib/auth.server'
import { notifyAdmin } from '~/lib/pusher.server'
import { generateUniqueReferralCode, resolveReferralCode } from '~/lib/referral.server'
import { LoginModal } from '~/components/LoginModal'
import { RegisterModal } from '~/components/RegisterModal'

const TEL_PATTERN = /^\+?[0-9]{8,15}$/

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getCurrentUser(request)
  if (user) throw redirect('/')
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const tel = String(formData.get('tel') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const next = String(formData.get('next') ?? '/') || '/'

  if (!tel || !password) return { error: 'Phone number and password are required.' }
  if (!TEL_PATTERN.test(tel)) return { error: 'Enter a valid phone number (8-15 digits, optional +).' }
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }

  try {
    const existing = await prisma.user.findUnique({ where: { tel } })
    if (existing) return { error: 'This phone number is already registered.' }

    const passwordHash = await hashPassword(password)
    const referralCode = await generateUniqueReferralCode()
    // Optional referrer — ignored silently if the code doesn't resolve.
    const refRaw = String(formData.get('ref') ?? '').trim() || null
    const referredById = await resolveReferralCode(refRaw)

    // Every new user gets THREE wallets. DEMO starts at 1M for practice; REAL
    // and PROMO start at 0. PROMO is funded only by first-topup admin approval.
    const user = await prisma.user.create({
      data: {
        tel,
        passwordHash,
        referralCode,
        referredById,
        wallets: {
          create: [
            { type: 'DEMO', balance: 1_000_000 },
            { type: 'REAL', balance: 0 },
            { type: 'PROMO', balance: 0 },
          ],
        },
      },
    })

    notifyAdmin('customer:registered', {
      id: user.id,
      tel: user.tel,
      createdAt: user.createdAt.toISOString(),
    })

    return createUserSession(user.id, request, next)
  } catch (err) {
    console.error('[register]', err)
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

// Direct visits to /register land here. The page shows the purple gradient
// background with the RegisterModal overlaid — same bottom-sheet UX as the
// inline modal rendered from the home page.
export default function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [showLogin, setShowLogin] = useState(false)

  return (
    <div
      className="min-h-screen font-sans"
      style={{
        background: 'linear-gradient(160deg, #3b0764 0%, #5b21b6 35%, #7c3aed 65%, #4c1d95 100%)',
      }}
    >
      <RegisterModal
        open={!showLogin}
        next={next}
        onClose={() => navigate('/')}
        onSwitchToLogin={() => setShowLogin(true)}
      />
      <LoginModal
        open={showLogin}
        next={next}
        onClose={() => navigate('/')}
        onSwitchToRegister={() => setShowLogin(false)}
      />
    </div>
  )
}
