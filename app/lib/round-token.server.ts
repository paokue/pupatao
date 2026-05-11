import { createHmac, timingSafeEqual } from 'node:crypto'

// Derive the signing key from PUSHER_SECRET (always present in production).
function secret(): string {
  const s = process.env.PUSHER_SECRET
  if (!s) throw new Error('PUSHER_SECRET env var is missing')
  return s
}

export function signRoundToken(data: unknown): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyRoundToken<T>(token: string): T {
  const dot = token.lastIndexOf('.')
  if (dot < 0) throw new Error('Malformed token')
  const payload = token.slice(0, dot)
  const sig     = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(
    createHmac('sha256', secret()).update(payload).digest('base64url'),
    'base64url',
  )
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
    throw new Error('Invalid token signature')
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T
}
