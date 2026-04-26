import type { Route } from './+types/api.avatar'
import { requireUser } from '~/lib/auth.server'
import { uploadToBunny } from '~/lib/bunny.server'

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Resource route — no UI. POST multipart/form-data with a `file` field.
// Returns JSON `{ url, path }` on success, `{ error }` with 400/500 on failure.
export async function action({ request }: Route.ActionArgs) {
  // requireUser hits the DB to resolve the session; if Atlas is unreachable the
  // throw bubbles up as a 500. Catch that and return a friendlier JSON body so
  // the client can show it in the inline upload-error banner.
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser(request)
  } catch (err) {
    // If it's a Response (redirect from requireUser for anonymous visitors),
    // let it bubble up — that's the intended redirect-to-/login behaviour.
    if (err instanceof Response) throw err
    const msg = err instanceof Error ? err.message : String(err)
    const isConn = /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(msg)
    console.error('[api/avatar] auth lookup failed:', msg)
    return Response.json(
      {
        error: isConn
          ? 'Cannot reach the database. Check your connection and try again.'
          : 'Session error. Please sign in again.',
      },
      { status: isConn ? 503 : 500 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 })
  }

  const ext = MIME_EXT[file.type]
  if (!ext) {
    return Response.json(
      { error: 'Unsupported image type. Use JPG, PNG, WebP, or GIF.' },
      { status: 400 },
    )
  }

  if (file.size > MAX_SIZE) {
    return Response.json(
      { error: `Image is too large. Maximum ${Math.round(MAX_SIZE / 1024 / 1024)}MB.` },
      { status: 400 },
    )
  }

  // Folder layout per user: u-<digits-of-tel>/profile/<timestamp>.<ext>
  // Keeps per-user assets together (profile/, payment-slips/, …).
  const telSlug = user.tel.replace(/\D/g, '') || user.id
  const key = `u-${telSlug}/profile/${Date.now()}.${ext}`

  try {
    const buf = await file.arrayBuffer()
    const { url, path } = await uploadToBunny({
      body: buf,
      path: key,
      contentType: file.type,
    })
    return Response.json({ url, path })
  } catch (err) {
    console.error('[api/avatar]', err)
    const msg = err instanceof Error ? err.message : 'Upload failed.'
    return Response.json({ error: msg }, { status: 500 })
  }
}

// Bare GET doesn't serve anything — reject 405 so it's not a spider target.
export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
