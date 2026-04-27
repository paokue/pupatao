import type { Route } from './+types/api.pusher-auth'
import { getCurrentUser } from '~/lib/auth.server'
import { getCurrentAdmin } from '~/lib/admin-auth.server'
import { authorizeChannel } from '~/lib/pusher.server'
import { ADMIN_CHANNEL, PRESENCE_LIVE, userChannel } from '~/lib/pusher-channels'

// Pusher posts here with `socket_id` + `channel_name` whenever the browser
// subscribes to a private/presence channel. We must verify the requester is
// allowed to listen on that channel and return the signed body Pusher expects.
export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData()
  const socketId = String(fd.get('socket_id') ?? '')
  const channel = String(fd.get('channel_name') ?? '')
  if (!socketId || !channel) {
    return Response.json({ error: 'Missing socket_id or channel_name' }, { status: 400 })
  }

  if (channel === ADMIN_CHANNEL) {
    const admin = await getCurrentAdmin(request)
    if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const body = authorizeChannel(socketId, channel)
    if (!body) return Response.json({ error: 'Pusher not configured' }, { status: 500 })
    return new Response(body, { headers: { 'Content-Type': 'application/json' } })
  }

  if (channel.startsWith('private-user-')) {
    const user = await getCurrentUser(request)
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (channel !== userChannel(user.id)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = authorizeChannel(socketId, channel)
    if (!body) return Response.json({ error: 'Pusher not configured' }, { status: 500 })
    return new Response(body, { headers: { 'Content-Type': 'application/json' } })
  }

  if (channel === PRESENCE_LIVE) {
    const admin = await getCurrentAdmin(request)
    if (admin) {
      const body = authorizeChannel(socketId, channel, {
        user_id: `admin:${admin.id}`,
        user_info: {
          kind: 'admin',
          name: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email,
        },
      })
      if (!body) return Response.json({ error: 'Pusher not configured' }, { status: 500 })
      return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    }
    const user = await getCurrentUser(request)
    if (user) {
      const body = authorizeChannel(socketId, channel, {
        user_id: `user:${user.id}`,
        user_info: {
          kind: 'user',
          tel: user.tel,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.tel,
        },
      })
      if (!body) return Response.json({ error: 'Pusher not configured' }, { status: 500 })
      return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    }
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  return Response.json({ error: 'Unknown channel' }, { status: 400 })
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
