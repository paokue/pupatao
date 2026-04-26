import type { Route } from './+types/api.bank-qr'
import { uploadToBunny } from '~/lib/bunny.server'
import { prisma } from '~/lib/prisma.server'

const MAX_SIZE = 5 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Bank receiving-QR upload. Authed; PUTs the file to Bunny under
// u-<tel>/bank-qr/<timestamp>.<ext>, then upserts the Bank row so the URL is
// the new "current QR" for this user. Used by the withdraw modal and the
// profile page (both call the same endpoint).
export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  let user: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    user = await getCurrentUser(request)
  } catch (err) {
    console.error('[api/bank-qr] session lookup failed:', err)
    return Response.json({ error: 'Could not verify session — please retry.' }, { status: 503 })
  }
  if (!user) {
    return Response.json({ error: 'You are signed out. Please sign in again.' }, { status: 401 })
  }

  let fd: FormData
  try {
    fd = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const file = fd.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 })
  }

  const ext = MIME_EXT[file.type]
  if (!ext) {
    return Response.json(
      { error: 'Unsupported file type. Use JPG, PNG, or WebP.' },
      { status: 400 },
    )
  }

  if (file.size > MAX_SIZE) {
    return Response.json(
      { error: `File too large. Maximum ${Math.round(MAX_SIZE / 1024 / 1024)}MB.` },
      { status: 400 },
    )
  }

  const telSlug = user.tel.replace(/\D/g, '') || user.id
  const key = `u-${telSlug}/bank-qr/${Date.now()}.${ext}`

  try {
    const buf = await file.arrayBuffer()
    const { url } = await uploadToBunny({ body: buf, path: key, contentType: file.type })
    await prisma.bank.upsert({
      where: { userId: user.id },
      create: { userId: user.id, qrUrl: url },
      update: { qrUrl: url },
    })
    return Response.json({ url, qrUrl: url })
  } catch (err) {
    console.error('[api/bank-qr]', err)
    const msg = err instanceof Error ? err.message : 'Upload failed.'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
