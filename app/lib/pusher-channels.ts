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
  kind: 'SYMBOL' | 'RANGE' | 'PAIR'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
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

// Fires per-bettor after the admin settles a round. Carries the customer's
// personal stake/payout/net + new balance so their result modal can render
// without an extra fetch.
export interface SettledBet {
  kind: 'SYMBOL' | 'RANGE' | 'PAIR'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  payout: number   // 0 if lost
  result: 'WIN' | 'LOSS'
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
