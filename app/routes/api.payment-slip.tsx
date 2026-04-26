import type { Route } from './+types/api.payment-slip'
import { requireUser } from '~/lib/auth.server'
import { uploadToBunny } from '~/lib/bunny.server'

const MAX_SIZE = 8 * 1024 * 1024 // 8 MB — slips can be larger than avatars
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

// Deposit slip upload. Authed via requireUser. PUTs the file to Bunny under
// u-<tel>/payment-slips/<timestamp>.<ext> and returns the public CDN URL,
// which the deposit form then submits as `slipUrl` to /wallet.
export async function action({ request }: Route.ActionArgs) {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser(request)
  } catch (err) {
    if (err instanceof Response) throw err
    const msg = err instanceof Error ? err.message : String(err)
    const isConn = /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(msg)
    console.error('[api/payment-slip] auth lookup failed:', msg)
    return Response.json(
      {
        error: isConn
          ? 'Cannot reach the database. Check your connection and try again.'
          : 'Session error. Please sign in again.',
      },
      { status: isConn ? 503 : 500 },
    )
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
      { error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or PDF.' },
      { status: 400 },
    )
  }

  if (file.size > MAX_SIZE) {
    return Response.json(
      { error: `File too large. Maximum ${Math.round(MAX_SIZE / 1024 / 1024)}MB.` },
      { status: 400 },
    )
  }

  // Per-user folder layout: u-<digits-of-tel>/payment-slips/<timestamp>.<ext>
  const telSlug = user.tel.replace(/\D/g, '') || user.id
  const key = `u-${telSlug}/payment-slips/${Date.now()}.${ext}`

  try {
    const buf = await file.arrayBuffer()
    const { url, path } = await uploadToBunny({
      body: buf,
      path: key,
      contentType: file.type,
    })
    return Response.json({ url, path })
  } catch (err) {
    console.error('[api/payment-slip]', err)
    const msg = err instanceof Error ? err.message : 'Upload failed.'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
