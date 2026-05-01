
// Simple in-memory user store with localStorage persistence (client-side demo)
// In production, replace with a real auth/database backend.

export type WalletKey = 'demo' | 'real' | 'promo'

// Amount granted by the demo-reset button (demo wallet only).
export const DEMO_RESET_AMOUNT = 1_000_000

export interface Transaction {
  id: string
  type: 'deposit' | 'withdraw' | 'win' | 'loss' | 'bet' | 'transfer'
  amount: number
  status: 'completed' | 'pending' | 'failed'
  timestamp: number
  note?: string
  wallet?: WalletKey
  target?: string   // recipient user id (transfer only)
}

export interface PlayRecord {
  id: string
  timestamp: number
  betAmount: number
  winAmount: number
  dice: string[]
  bets: { symbol: string; amount: number }[]
  rangeBets?: { range: 'low' | 'middle' | 'high'; amount: number }[]
  pairBets?: { a: string; b: string; amount: number }[]
  result: 'win' | 'loss'
  wallet?: WalletKey
}

export interface UserProfile {
  id: string
  name: string
  email: string
  avatar: string              // initials or url
  balance: number             // mirror of balances[activeWallet] (kept in sync)
  activeWallet: WalletKey
  balances: { demo: number; real: number; promo: number }
  joinedAt: number
  transactions: Transaction[]
  playHistory: PlayRecord[]
}

const DEFAULT_USER: UserProfile = {
  id: 'u_001',
  name: 'Lucky Player',
  email: 'player@example.com',
  avatar: 'LP',
  activeWallet: 'demo',
  balances: { demo: DEMO_RESET_AMOUNT, real: 0, promo: 0 },
  balance: DEMO_RESET_AMOUNT,
  joinedAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
  transactions: [
    {
      id: 't_001',
      type: 'deposit',
      amount: DEMO_RESET_AMOUNT,
      status: 'completed',
      timestamp: Date.now() - 1000 * 60 * 60 * 24 * 30,
      note: 'Initial demo balance',
      wallet: 'demo',
    },
  ],
  playHistory: [],
}

function loadUser(): UserProfile {
  if (typeof window === 'undefined') return DEFAULT_USER
  try {
    const raw = localStorage.getItem('fpc_user')
    if (!raw) return { ...DEFAULT_USER }
    const parsed = JSON.parse(raw) as Partial<UserProfile> & { balance?: number }
    // Migration: old single-balance format → dual-wallet, dual-wallet → triple.
    if (!parsed.balances) {
      parsed.balances = { demo: parsed.balance ?? DEMO_RESET_AMOUNT, real: 0, promo: 0 }
    } else if (typeof (parsed.balances as { promo?: number }).promo !== 'number') {
      parsed.balances = { ...parsed.balances, promo: 0 }
    }
    if (!parsed.activeWallet) parsed.activeWallet = 'demo'
    parsed.balance = parsed.balances[parsed.activeWallet]
    return parsed as UserProfile
  } catch { }
  return { ...DEFAULT_USER }
}

function saveUser(user: UserProfile) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('fpc_user', JSON.stringify(user))
  } catch { }
}

// Module-level singleton so all components share the same reference
let _user: UserProfile | null = null
const _listeners: Set<() => void> = new Set()

export function getUser(): UserProfile {
  if (!_user) _user = loadUser()
  return _user
}

export function subscribeUser(fn: () => void) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

function notify() {
  _listeners.forEach(fn => fn())
}

// Apply a new balance atomically to both `balance` and `balances[activeWallet]`.
function withBalance(u: UserProfile, newBalance: number): UserProfile {
  return {
    ...u,
    balance: newBalance,
    balances: { ...u.balances, [u.activeWallet]: newBalance },
  }
}

// Apply a new balance to a specific wallet (keeps `balance` in sync if it's the active one).
function withWalletBalance(u: UserProfile, wallet: WalletKey, newBalance: number): UserProfile {
  return {
    ...u,
    balance: wallet === u.activeWallet ? newBalance : u.balance,
    balances: { ...u.balances, [wallet]: newBalance },
  }
}

export function updateUserProfile(patch: Partial<Pick<UserProfile, 'name' | 'email' | 'avatar'>>) {
  const u = getUser()
  _user = { ...u, ...patch }
  saveUser(_user)
  notify()
}

// Switch active wallet. `balance` is swapped to the target wallet's stored amount.
export function switchWallet(wallet: WalletKey) {
  const u = getUser()
  if (u.activeWallet === wallet) return
  _user = {
    ...u,
    activeWallet: wallet,
    balance: u.balances[wallet],
  }
  saveUser(_user)
  notify()
}

// Reset ONLY the demo wallet to DEMO_RESET_AMOUNT. Real wallet is never affected.
export function resetDemoBalance() {
  const u = getUser()
  const tx: Transaction = {
    id: `t_${Date.now()}`,
    type: 'deposit',
    amount: DEMO_RESET_AMOUNT,
    status: 'completed',
    timestamp: Date.now(),
    note: 'Demo balance reset',
    wallet: 'demo',
  }
  _user = {
    ...u,
    balances: { ...u.balances, demo: DEMO_RESET_AMOUNT },
    balance: u.activeWallet === 'demo' ? DEMO_RESET_AMOUNT : u.balance,
    transactions: [tx, ...u.transactions].slice(0, 500),
  }
  saveUser(_user)
  notify()
}

export function deposit(amount: number, wallet?: WalletKey): boolean {
  if (amount <= 0) return false
  const u = getUser()
  const target = wallet ?? u.activeWallet
  const tx: Transaction = {
    id: `t_${Date.now()}`,
    type: 'deposit',
    amount,
    status: 'completed',
    timestamp: Date.now(),
    note: 'Deposit',
    wallet: target,
  }
  _user = withWalletBalance(
    { ...u, transactions: [tx, ...u.transactions].slice(0, 500) },
    target,
    u.balances[target] + amount,
  )
  saveUser(_user)
  notify()
  return true
}

export function withdraw(amount: number, wallet?: WalletKey): boolean {
  const u = getUser()
  const target = wallet ?? u.activeWallet
  if (amount <= 0 || amount > u.balances[target]) return false
  const tx: Transaction = {
    id: `t_${Date.now()}`,
    type: 'withdraw',
    amount,
    status: 'completed',
    timestamp: Date.now(),
    note: 'Withdrawal',
    wallet: target,
  }
  _user = withWalletBalance(
    { ...u, transactions: [tx, ...u.transactions].slice(0, 500) },
    target,
    u.balances[target] - amount,
  )
  saveUser(_user)
  notify()
  return true
}

// Transfer to another user. In the stub we only validate the target id format and deduct locally
// — there's no recipient state until the backend is wired up.
export function transfer(amount: number, targetUserId: string, wallet?: WalletKey): boolean {
  if (amount <= 0) return false
  const u = getUser()
  const target = wallet ?? u.activeWallet
  if (amount > u.balances[target]) return false
  const tx: Transaction = {
    id: `t_${Date.now()}`,
    type: 'transfer',
    amount,
    status: 'completed',
    timestamp: Date.now(),
    note: `Transfer to ${targetUserId}`,
    wallet: target,
    target: targetUserId,
  }
  _user = withWalletBalance(
    { ...u, transactions: [tx, ...u.transactions].slice(0, 500) },
    target,
    u.balances[target] - amount,
  )
  saveUser(_user)
  notify()
  return true
}

export function recordPlay(record: Omit<PlayRecord, 'id'>, balanceChange: number) {
  const u = getUser()
  const play: PlayRecord = { id: `p_${Date.now()}`, ...record, wallet: u.activeWallet }
  const tx: Transaction = {
    id: `t_${Date.now()}`,
    type: record.result === 'win' ? 'win' : 'loss',
    amount: Math.abs(balanceChange),
    status: 'completed',
    timestamp: Date.now(),
    note: record.result === 'win' ? `Won ${record.winAmount}` : `Lost ${record.betAmount}`,
    wallet: u.activeWallet,
  }
  _user = withBalance(
    {
      ...u,
      playHistory: [play, ...u.playHistory].slice(0, 200),
      transactions: [tx, ...u.transactions].slice(0, 500),
    },
    u.balance + balanceChange,
  )
  saveUser(_user)
  notify()
}

export function setBalance(newBalance: number) {
  const u = getUser()
  _user = withBalance(u, newBalance)
  saveUser(_user)
  notify()
}

// Sync all wallet balances from the server (called after login / on mount when
// the root loader provides DB-backed wallet rows). The active wallet's mirrored
// `balance` field is also updated so the play page reflects the real value.
export function hydrateBalances(demo: number, real: number, promo: number) {
  const u = getUser()
  const next: UserProfile = {
    ...u,
    balances: { demo, real, promo },
    balance:
      u.activeWallet === 'demo' ? demo
        : u.activeWallet === 'real' ? real
          : promo,
  }
  // Skip the persist+notify churn if nothing actually changed.
  if (
    next.balances.demo === u.balances.demo &&
    next.balances.real === u.balances.real &&
    next.balances.promo === u.balances.promo &&
    next.balance === u.balance
  ) {
    return
  }
  _user = next
  saveUser(_user)
  notify()
}
