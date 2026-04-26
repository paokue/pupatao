import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { redirect } from 'react-router'
import type { Admin } from '@prisma/client'
import { prisma } from './prisma.server'

const ADMIN_COOKIE = 'pupatao_admin_session'
const ADMIN_TTL_DAYS = 7
const ADMIN_TTL_SECONDS = ADMIN_TTL_DAYS * 86_400

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildSetCookie(value: string, maxAgeSeconds: number): string {
  const attrs = [
    `${ADMIN_COOKIE}=${value}`,
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

export async function createAdminSession(adminId: string, request: Request, redirectTo = '/admin') {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + ADMIN_TTL_SECONDS * 1000)

  await prisma.adminSession.create({
    data: {
      adminId,
      tokenHash,
      expiresAt,
      userAgent: request.headers.get('user-agent') ?? undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    },
  })

  await prisma.admin.update({
    where: { id: adminId },
    data: { lastLoginAt: new Date() },
  })

  return redirect(redirectTo, {
    headers: { 'Set-Cookie': buildSetCookie(rawToken, ADMIN_TTL_SECONDS) },
  })
}

export async function getCurrentAdmin(request: Request): Promise<Admin | null> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[ADMIN_COOKIE]
  if (!raw) return null

  const tokenHash = hashToken(raw)
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { admin: true },
  })
  if (!session || session.revokedAt) return null
  if (session.expiresAt.getTime() < Date.now()) return null
  if (session.admin.status !== 'ACTIVE') return null

  // Throttled lastUsedAt bump (same pattern as user sessions).
  const STALE_MS = 5 * 60 * 1000
  if (Date.now() - session.lastUsedAt.getTime() > STALE_MS) {
    prisma.adminSession
      .updateMany({
        where: {
          id: session.id,
          lastUsedAt: { lt: new Date(Date.now() - STALE_MS) },
        },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => { /* ignore */ })
  }

  return session.admin
}

export async function requireAdmin(request: Request): Promise<Admin> {
  const admin = await getCurrentAdmin(request)
  if (!admin) {
    const url = new URL(request.url)
    const next = encodeURIComponent(url.pathname + url.search)
    throw redirect(`/admin/login?next=${next}`)
  }
  return admin
}

export async function adminLogout(request: Request, redirectTo = '/admin/login') {
  const cookies = parseCookies(request.headers.get('cookie'))
  const raw = cookies[ADMIN_COOKIE]
  if (raw) {
    const tokenHash = hashToken(raw)
    await prisma.adminSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  return redirect(redirectTo, {
    headers: { 'Set-Cookie': buildSetCookie('', 0) },
  })
}

export async function verifyAdminPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
