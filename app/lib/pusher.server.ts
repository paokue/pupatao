import Pusher from 'pusher'
import {
  ADMIN_CHANNEL,
  COMPETITION_CHANNEL,
  GAME_CHANNEL,
  PRESENCE_LIVE,
  userChannel,
  type BetPlacedPayload,
  type CompetitionEndedPayload,
  type CompetitionParticipantChangedPayload,
  type CompetitionResetPayload,
  type CompetitionSummarizedPayload,
  type CompetitionToggledPayload,
  type CustomerRegisteredPayload,
  type LiveEndedPayload,
  type LiveScheduledPayload,
  type RankingUpdatedPayload,
  type RewardCreditedPayload,
  type RoundDicePayload,
  type RoundResolvedPayload,
  type RoundSettledPayload,
  type RoundStartedPayload,
  type RoundStreamUpdatedPayload,
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

// Send multiple events in a single HTTP request (Pusher triggerBatch, max 10 per call).
// Use this instead of looping notifyAdmin when firing N events at once (e.g. live bets).
async function triggerBatchSafe(events: Array<{ channel: string; name: string; data: unknown }>): Promise<void> {
  if (events.length === 0) return
  const c = client()
  if (!c) return
  // Pusher triggerBatch cap is 10 events per call — chunk if needed.
  for (let i = 0; i < events.length; i += 10) {
    const chunk = events.slice(i, i + 10)
    try {
      await c.triggerBatch(chunk.map(e => ({ channel: e.channel, name: e.name, data: JSON.stringify(e.data) })))
    } catch (err) {
      console.error('[pusher] triggerBatch failed', err)
    }
  }
}

export function notifyAdmin(event: 'transaction:created', payload: TxCreatedPayload): Promise<void>
export function notifyAdmin(event: 'transaction:resolved', payload: TxResolvedPayload): Promise<void>
export function notifyAdmin(event: 'customer:registered', payload: CustomerRegisteredPayload): Promise<void>
export function notifyAdmin(event: 'bet:placed', payload: BetPlacedPayload): Promise<void>
export function notifyAdmin(event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyAdmin(event: 'round:started', payload: RoundStartedPayload): Promise<void>
export function notifyAdmin(event: 'round:dice', payload: RoundDicePayload): Promise<void>
export function notifyAdmin(event: 'round:streamUpdated', payload: RoundStreamUpdatedPayload): Promise<void>
export function notifyAdmin(event: 'live:ended', payload: LiveEndedPayload): Promise<void>
export function notifyAdmin(event: 'live:scheduled', payload: LiveScheduledPayload): Promise<void>
export function notifyAdmin(event: string, payload: unknown): Promise<void> {
  return triggerSafe(ADMIN_CHANNEL, event, payload)
}

// Send multiple admin events in one HTTP request. Use for live bet fanout where
// a single player may place N bets — fires them all in one Pusher API call.
export function notifyAdminBatch(events: Array<{ event: string; payload: unknown }>): Promise<void> {
  return triggerBatchSafe(events.map(e => ({ channel: ADMIN_CHANNEL, name: e.event, data: e.payload })))
}

// Broadcast on the public-ish presence-live channel — every customer currently
// in LIVE mode (and every admin watching the live page) receives it. Used for
// round lifecycle signals that need to reach customers, who can't subscribe to
// the admin-only channel.
export function notifyPresenceLive(event: 'round:started', payload: RoundStartedPayload): Promise<void>
export function notifyPresenceLive(event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyPresenceLive(event: 'round:dice', payload: RoundDicePayload): Promise<void>
export function notifyPresenceLive(event: 'round:streamUpdated', payload: RoundStreamUpdatedPayload): Promise<void>
export function notifyPresenceLive(event: 'live:ended', payload: LiveEndedPayload): Promise<void>
export function notifyPresenceLive(event: 'live:scheduled', payload: LiveScheduledPayload): Promise<void>
export function notifyPresenceLive(event: string, payload: unknown): Promise<void> {
  return triggerSafe(PRESENCE_LIVE, event, payload)
}

// Broadcast to every client regardless of mode — used to nudge self-play
// players that a LIVE round just opened/ended without inflating the
// presence-live viewer count.
export function notifyGame(event: 'round:started', payload: RoundStartedPayload): Promise<void>
export function notifyGame(event: 'live:ended', payload: LiveEndedPayload): Promise<void>
export function notifyGame(event: string, payload: unknown): Promise<void> {
  return triggerSafe(GAME_CHANNEL, event, payload)
}

export function notifyCompetition(event: 'ranking:updated', payload: RankingUpdatedPayload): Promise<void>
export function notifyCompetition(event: 'competition:reset', payload: CompetitionResetPayload): Promise<void>
export function notifyCompetition(event: 'competition:toggled', payload: CompetitionToggledPayload): Promise<void>
export function notifyCompetition(event: 'competition:summarized', payload: CompetitionSummarizedPayload): Promise<void>
export function notifyCompetition(event: 'competition:ended', payload: CompetitionEndedPayload): Promise<void>
export function notifyCompetition(event: 'competition:participantChanged', payload: CompetitionParticipantChangedPayload): Promise<void>
export function notifyCompetition(event: string, payload: unknown): Promise<void> {
  return triggerSafe(COMPETITION_CHANNEL, event, payload)
}

export function notifyUser(userId: string, event: 'transaction:updated', payload: TxUpdatedPayload): Promise<void>
export function notifyUser(userId: string, event: 'round:resolved', payload: RoundResolvedPayload): Promise<void>
export function notifyUser(userId: string, event: 'round:settled', payload: RoundSettledPayload): Promise<void>
export function notifyUser(userId: string, event: 'reward:credited', payload: RewardCreditedPayload): Promise<void>
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
