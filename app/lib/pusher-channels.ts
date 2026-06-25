// Channel names + event payload shapes shared between the Pusher server SDK
// (lib/pusher.server.ts) and the browser client (lib/pusher.client.ts). Lives
// in its own file because importing from a `.server.ts` file pulls Node-only
// modules into the client bundle.

export const ADMIN_CHANNEL = 'private-admin'
export const PRESENCE_LIVE = 'presence-live'

export function userChannel(userId: string): string {
  return `private-user-${userId}`
}

export interface TxCreatedPayload {
  id: string
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_OUT' | 'TRANSFER_IN'
  amount: number
  status: string
  createdAt: string
  user: { id: string; tel: string; name: string | null }
}

export interface TxUpdatedPayload {
  id: string
  status: 'COMPLETED' | 'CANCELLED' | 'FAILED'
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_OUT' | 'TRANSFER_IN'
  amount: number
  balanceAfter: number
  note: string | null
  rejectReasonCode?: string | null // set on rejection — looked up via i18n `rejectReason.<code>` for the customer's locale
}

export interface TxResolvedPayload {
  id: string
}

export interface CustomerRegisteredPayload {
  id: string
  tel: string
  createdAt: string
}

export interface BetPlacedPayload {
  roundId: string
  mode: 'RANDOM' | 'LIVE'
  userId: string
  userTel: string
  userName: string | null
  walletType: 'DEMO' | 'REAL' | 'PROMO'
  kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  exactSum: number | null
  createdAt: string
}

export interface RoundResolvedPayload {
  roundId: string
  mode: 'RANDOM' | 'LIVE'
  dice: string[]
  diceSum: number
}

// Fires when an admin opens a new LIVE round. Lets the customer's home page
// (subscribed via presence-live while in LIVE mode) refresh its loader so the
// stream URL + countdown reflect the new round without a manual refresh.
export interface RoundStartedPayload {
  roundId: string
  streamUrl: string | null
  bettingClosesAt: string  // ISO timestamp
}

// Fires every time the admin reveals (or changes) one of the three dice on
// the admin Live page. The customer's awaiting-result panel uses this to fill
// in the dice progressively without polling.
export interface RoundDicePayload {
  roundId: string
  dieIndex: 1 | 2 | 3
  symbol: string  // DiceSymbol — kept as plain string for transport
}

// Fires when the admin updates the stream URL on an in-flight round. The
// customer's home page revalidates so the iframe swaps to the new feed
// without requiring an app restart.
export interface RoundStreamUpdatedPayload {
  roundId: string
  streamUrl: string | null
}

// Fires when the admin clicks "End Live" — stream URL has been cleared and
// customers should switch from the stream view to the schedule/idle screen.
// Public channel for competition ranking updates — no auth needed.
export const COMPETITION_CHANNEL = 'competition'

// Public channel broadcasting LIVE round lifecycle to every customer
// regardless of which mode (self-play/live) they're currently on. Unlike
// PRESENCE_LIVE, subscribing here does NOT count as a "viewer" — it just lets
// self-play players get nudged ("a live round just opened") without joining
// the presence list. No auth needed.
export const GAME_CHANNEL = 'game'

// Fired whenever any user's demo balance changes so all open ranking pages
// can re-fetch and animate the position change.
export interface RankingUpdatedPayload {
  userId: string
  newDemoBalance: number
}

// Fired when admin resets all demo wallets — users update their in-app balance.
export interface CompetitionResetPayload {
  newBalance: number  // always 1_000_000
}

// Fired when admin toggles competition ON or OFF.
// When enabled=true: users on demo self-play should switch to real wallet.
export interface CompetitionToggledPayload {
  enabled: boolean
}

// Fired when admin takes the top-3 summary snapshot.
export interface CompetitionSummarizedPayload {
  winners: { rank: number; userId: string; name: string | null; tel: string; profile: string | null; demoBalance: number }[]
}

// Fired when admin ends the competition (saves history, clears all settings).
export interface CompetitionEndedPayload {}

// Fired when a user joins or is removed from a competition.
export interface CompetitionParticipantChangedPayload {
  totalParticipants: number
}

export interface LiveEndedPayload {
  // intentionally empty — revalidation handles the rest
}

// Fires when the admin sets or clears the next live schedule. ISO UTC strings;
// null means the schedule was removed.
export interface LiveScheduledPayload {
  start: string | null
  end:   string | null
}

// Fires per-bettor after the admin settles a round. Carries the customer's
// personal stake/payout/net + new balance so their result modal can render
// without an extra fetch.
export interface SettledBet {
  kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  exactSum: number | null
  payout: number   // 0 if lost; refunded stake if REFUNDED
  result: 'WIN' | 'LOSS' | 'REFUNDED'
}
// Fired after admin settles a live round when a promotion bonus is credited
// to the user's REAL wallet (win streak, triple bonus, etc.).
export interface RewardCreditedPayload {
  amount: number    // bonus amount in ₭
  note: string      // display note in Lao (e.g. "ຂອງຂວັນຊະນະ 4 ຕາຊ້ອນ")
  newBalance: number
  streak: number    // the streak count that triggered this bonus
}

export interface RoundSettledPayload {
  roundId: string
  dice: string[]
  diceSum: number
  stake: number
  payout: number
  net: number  // payout - stake; positive = win, negative = loss, zero = break-even
  newBalance: number
  bets: SettledBet[]  // each bet the customer placed, with its individual result
}
