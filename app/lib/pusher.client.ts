import type { Channel, PresenceChannel, default as PusherClient } from 'pusher-js'

// Singleton + refcount registry. Pusher-js itself is loaded *lazily* on first
// browser use so SSR module evaluation never touches its Node entry (which
// drags in WebSocket polyfills and choked the dev server when imported eagerly).
let _client: PusherClient | null = null
let _loading: Promise<PusherClient | null> | null = null
const refCounts = new Map<string, number>()

async function ensureClient(): Promise<PusherClient | null> {
  if (typeof window === 'undefined') return null
  if (_client) return _client
  if (_loading) return _loading

  const key = import.meta.env.VITE_PUSHER_KEY as string | undefined
  const cluster = import.meta.env.VITE_PUSHER_CLUSTER as string | undefined
  if (!key || !cluster) {
    if (import.meta.env.DEV) {
      console.warn('[pusher] VITE_PUSHER_KEY / VITE_PUSHER_CLUSTER not set — realtime disabled')
    }
    return null
  }

  _loading = import('pusher-js').then(mod => {
    const Ctor = mod.default
    _client = new Ctor(key, { cluster, authEndpoint: '/api/pusher-auth' })
    _loading = null
    return _client
  })
  return _loading
}

// Refcounted subscribe so multiple hooks can share a channel without one
// unmount yanking the subscription out from under the others. Returns a
// promise so callers can await the loaded Pusher instance.
export async function subscribeChannel(channelName: string): Promise<Channel | null> {
  const c = await ensureClient()
  if (!c) return null
  const next = (refCounts.get(channelName) ?? 0) + 1
  refCounts.set(channelName, next)
  return c.subscribe(channelName)
}

export function unsubscribeChannel(channelName: string): void {
  if (!_client) return
  const next = (refCounts.get(channelName) ?? 0) - 1
  if (next <= 0) {
    refCounts.delete(channelName)
    _client.unsubscribe(channelName)
  } else {
    refCounts.set(channelName, next)
  }
}

export type { Channel, PresenceChannel }
