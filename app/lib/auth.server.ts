import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { redirect } from 'react-router'
import type { User } from '@prisma/client'
import { prisma } from './prisma.server'

const SESSION_COOKIE = 'pupatao_session'
const SESSION_TTL_DAYS = 30
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 86_400

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildSetCookie(value: string, maxAgeSeconds: number): string {
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const raw of header.split(';')) {
    const eq = raw.indexOf('=')
    if (eq < 0) continue
    const k = raw.slice(0, eq).trim()
    const v = raw.slice(eq + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

// Issue a session + Set-Cookie and redirect the browser.
export async function createUserSession(userId: string, request: Request, redirectTo = '/') {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: request.headers.get('user-agent') ?? undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    },
  })

  return redirect(redirectTo, {
    headers: { 'Set-Cookie': buildSetCookie(rawToken, SESSION_TTL_SECONDS) },
  })
}

// Read the cookie, look up the matching (non-revoked, non-expired) session,
// and return the associated user. Returns null for anonymous visitors.
export async function getCurrentUser(request: Request): Promise<User | null> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[SESSION_COOKIE]
  if (!raw) return null

  const tokenHash = hashToken(raw)
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  })
  if (!session || session.revokedAt) return null
  if (session.expiresAt.getTime() < Date.now()) return null
  if (session.user.status !== 'ACTIVE') return null

  // Best-effort `lastUsedAt` bump, throttled to once every 5 minutes per session.
  // Without the throttle, concurrent requests (page load + avatar POST, etc.)
  // race on the same row and MongoDB returns a WriteConflict; using updateMany
  // with a `lt` guard means only the first one in a 5-min window matches.
  const STALE_MS = 5 * 60 * 1000
  if (Date.now() - session.lastUsedAt.getTime() > STALE_MS) {
    prisma.session
      .updateMany({
        where: {
          id: session.id,
          lastUsedAt: { lt: new Date(Date.now() - STALE_MS) },
        },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => { /* ignore */ })
  }

  return session.user
}

// Use in protected-route loaders. Throws a redirect to /login if anonymous.
export async function requireUser(request: Request): Promise<User> {
  const user = await getCurrentUser(request)
  if (!user) {
    const url = new URL(request.url)
    const next = encodeURIComponent(url.pathname + url.search)
    throw redirect(`/login?next=${next}`)
  }
  return user
}

// Revoke the current session + clear the cookie.
export async function logout(request: Request, redirectTo = '/login') {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[SESSION_COOKIE]
  if (raw) {
    const tokenHash = hashToken(raw)
    await prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  return redirect(redirectTo, {
    headers: { 'Set-Cookie': buildSetCookie('', 0) },
  })
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}
