import Pusher from 'pusher'
import {
  ADMIN_CHANNEL,
  PRESENCE_LIVE,
  userChannel,
  type BetPlacedPayload,
  type CustomerRegisteredPayload,
  type RoundDicePayload,
  type RoundResolvedPayload,
  type RoundSettledPayload,
  type RoundStartedPayload,
  type TxCreatedPayload,
  type TxResolvedPayload,
  type TxUpdatedPayload,
} from './pusher-channels'

let _pusher: Pusher | null = null

function client(): Pusher | null {
  if (_pusher) return _pusher
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    return null
  }
  _pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  })
  return _pusher
}

// Fire-and-forget. We never want a Pusher outage to fail a user's deposit.
async function triggerSafe(channel: string | string[], event: string, payload: unknown): Promise<void> {
  const c = client()
  if (!c) return
  try {
    await c.trigger(channel, event, payload)
  } catch (err) {
    console.error('[pusher] trigger failed', { channel, event }, err)
  }
}

export function notifyAdmin(event: 'transaction:created', payload: TxCreatedPayload): Promise<void>
export function notifyAdmin(event: 'transaction:resolved', payload: TxResolvedPayload): Promise<void>
export function notifyAdmin(event: 'customer:registered', payload: CustomerRegisteredPayload): Promise<void>
export function notifyAdmin(event: 'bet:placed', payload: BetPlacedPayload): Promise<void>
export function notifyAdmin(event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyAdmin(event: 'round:started', payload: RoundStartedPayload): Promise<void>
export function notifyAdmin(event: 'round:dice', payload: RoundDicePayload): Promise<void>
export function notifyAdmin(event: string, payload: unknown): Promise<void> {
  return triggerSafe(ADMIN_CHANNEL, event, payload)
}

// Broadcast on the public-ish presence-live channel — every customer currently
// in LIVE mode (and every admin watching the live page) receives it. Used for
// round lifecycle signals that need to reach customers, who can't subscribe to
// the admin-only channel.
export function notifyPresenceLive(event: 'round:started', payload: RoundStartedPayload): Promise<void>
export function notifyPresenceLive(event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyPresenceLive(event: 'round:dice', payload: RoundDicePayload): Promise<void>
export function notifyPresenceLive(event: string, payload: unknown): Promise<void> {
  return triggerSafe(PRESENCE_LIVE, event, payload)
}

export function notifyUser(userId: string, event: 'transaction:updated', payload: TxUpdatedPayload): Promise<void>
export function notifyUser(userId: string, event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyUser(userId: string, event: 'round:settled', payload: RoundSettledPayload): Promise<void>
export function notifyUser(userId: string, event: string, payload: unknown): Promise<void> {
  return triggerSafe(userChannel(userId), event, payload)
}

// Exposed to the auth route. Returns the JSON body Pusher's client expects.
export function authorizeChannel(
  socketId: string,
  channel: string,
  presenceData?: { user_id: string; user_info?: Record<string, unknown> },
): string | null {
  const c = client()
  if (!c) return null
  if (channel.startsWith('presence-')) {
    if (!presenceData) return null
    return JSON.stringify(c.authorizeChannel(socketId, channel, presenceData))
  }
  return JSON.stringify(c.authorizeChannel(socketId, channel))
}

export function isPusherConfigured(): boolean {
  return client() !== null
}
