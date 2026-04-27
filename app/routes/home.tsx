import { useState, useCallback, useEffect, useRef } from 'react'
import { Form, useFetcher, useLoaderData, useNavigate, useOutletContext, useRevalidator, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { Route } from './+types/home'
import { LoginModal } from '~/components/LoginModal'
import { RegisterModal } from '~/components/RegisterModal'
import { useUser } from '~/hooks/use-user'
import type { SessionUser, SessionWallets } from '~/root'
import { useT } from '~/lib/use-t'
import { LanguageSwitch } from '~/components/LanguageSwitch'
import { setBalance as storeSetBalance, recordPlay, switchWallet, resetDemoBalance, hydrateBalances, DEMO_RESET_AMOUNT } from '~/lib/user-store'
import { useSoundEngine, playClick, playChipPlace, playCoin, startBgMusic, stopBgMusic } from '~/hooks/use-sound-engine'
import { usePresenceMembers, usePusherEvent } from '~/hooks/use-pusher'
import {
  PRESENCE_LIVE,
  userChannel,
  type RoundDicePayload,
  type RoundResolvedPayload,
  type RoundSettledPayload,
  type RoundStartedPayload,
  type TxUpdatedPayload,
} from '~/lib/pusher-channels'
import { LogOut, Pencil, ReceiptText, Undo, User, Volume2, VolumeOff, Wallet } from 'lucide-react'

type SymbolKey = 'fish' | 'prawn' | 'crab' | 'rooster' | 'gourd' | 'frog'

interface Bet {
  cell: number        // BOARD_LAYOUT index — each cell has its own single bet,
  symbol: SymbolKey   // even when two cells share a symbol (duplicates).
  amount: number
}

const SYMBOLS: SymbolKey[] = ['gourd', 'frog', 'rooster', 'prawn', 'crab', 'fish']

// Board layout (may repeat symbols visually without affecting dice odds)
const BOARD_LAYOUT: SymbolKey[] = [
  'gourd', 'frog', 'rooster', 'gourd',
  'prawn', 'crab', 'fish', 'prawn',
]

// Symbol-to-value map for dice sum (low/middle/high bets)
const SYMBOL_VALUES: Record<SymbolKey, number> = {
  prawn: 1, crab: 2, fish: 3, rooster: 4, frog: 5, gourd: 6,
}

type RangeKey = 'low' | 'middle' | 'high'

interface RangeBet {
  range: RangeKey
  amount: number
}

const RANGE_CONFIG: ReadonlyArray<{
  key: RangeKey; label: string; range: string;
  min: number; max: number; multiplier: number;
  bg: string; border: string; color: string;
}> = [
    {
      key: 'low', label: 'LOW', range: '1-8', min: 3, max: 8,
      multiplier: 2, bg: 'linear-gradient(135deg, #0369a1, #0c4a6e)', border: '#38bdf8', color: '#bae6fd'
    },
    {
      key: 'middle', label: 'MIDDLE', range: '9-10', min: 9, max: 10,
      multiplier: 4, bg: 'linear-gradient(135deg, #a21caf, #581c87)', border: '#e879f9', color: '#fae8ff'
    },
    {
      key: 'high', label: 'HIGH', range: '11-18', min: 11, max: 18,
      multiplier: 2, bg: 'linear-gradient(135deg, #b91c1c, #7f1d1d)', border: '#fb7185', color: '#ffe4e6'
    },
  ]

// Pair bet: 1 chip covers two adjacent cells. Wins when BOTH symbols appear in the roll.
interface PairBet {
  a: SymbolKey    // symbol at cellA
  b: SymbolKey    // symbol at cellB
  cellA: number   // board layout index (always the lower of the two)
  cellB: number
  amount: number
}

const PAIR_MULTIPLIER = 6  // stake 100 → 600 total (5× profit)

// Embed-URL helper used by the LIVE iframe — supports YouTube watch/embed
// links, Facebook video/live links, and direct MP4 / HLS file URLs (admin can
// paste any of these). Facebook URLs are rewritten to the plugin endpoint
// because facebook.com itself sends X-Frame-Options that forbid direct iframe
// embedding ("refused to connect").
function liveEmbedSrc(rawUrl: string | null): { kind: 'iframe' | 'video'; src: string } | null {
  if (!rawUrl) return null
  if (/\.(mp4|webm|mov|m3u8)(\?|$)/i.test(rawUrl)) return { kind: 'video', src: rawUrl }
  const yt = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1&controls=0` }
  if (/(?:facebook\.com|fb\.watch)/i.test(rawUrl)) {
    const href = encodeURIComponent(rawUrl)
    return { kind: 'iframe', src: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&autoplay=true&mute=1` }
  }
  return { kind: 'iframe', src: rawUrl }
}

type LivePhase = 'idle' | 'betting' | 'awaiting_result'

// Colors for pair connector lines, hashed from cell indices so same pair always gets the same color.
const PAIR_COLORS = ['#3b82f6', '#22d3ee', '#f472b6', '#fbbf24', '#a3e635', '#f87171', '#c084fc', '#fb923c']
function pairColor(cellA: number, cellB: number): string {
  return PAIR_COLORS[(cellA * 11 + cellB) % PAIR_COLORS.length]
}

// Board is 4 columns × 2 rows. Two cells are adjacent if they differ by ≤1 row AND ≤1 col.
function areAdjacent(idx1: number, idx2: number): boolean {
  if (idx1 === idx2) return false
  const r1 = Math.floor(idx1 / 4), c1 = idx1 % 4
  const r2 = Math.floor(idx2 / 4), c2 = idx2 % 4
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1
}

const SYMBOL_NAMES: Record<SymbolKey, string> = {
  fish: 'FISH',
  prawn: 'PRAWN',
  crab: 'CRAB',
  rooster: 'ROOSTER',
  gourd: 'GOURD',
  frog: 'FROG',
}

const MAX_CHIP = 100_000  // Maximum allowed chip amount (₭)

const CHIP_CONFIG = [
  { value: 5000, label: '5,000', colors: 'from-gray-600 to-gray-800', border: '#9CA3AF' },
  { value: 10000, label: '10,000', colors: 'from-blue-500 to-blue-700', border: '#60A5FA' },
  { value: 20000, label: '20,000', colors: 'from-blue-500 to-blue-700', border: '#60A5FA' },
  { value: 30000, label: '30,000', colors: 'from-blue-500 to-blue-700', border: '#60A5FA' },
  { value: 50000, label: '50,000', colors: 'from-green-500 to-green-700', border: '#4ADE80' },
  { value: 100000, label: '100,000', colors: 'from-yellow-500 to-yellow-700', border: '#FCD34D' },
]

function formatAmount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return n.toString()
}

interface ProfileDropdownProps {
  name: string
  onClose: () => void
}

function ProfileDropdown({ name, onClose }: ProfileDropdownProps) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const items = [
    { label: t('menu.wallet'),       icon: <Wallet size={18} />,      href: '/wallet',  desc: t('menu.walletDesc') },
    { label: t('menu.playHistory'),  icon: <ReceiptText size={18} />, href: '/history', desc: t('menu.playHistoryDesc') },
    { label: t('menu.profile'),      icon: <User size={18} />,        href: '/profile', desc: t('menu.profileDesc') },
  ]

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 rounded-md overflow-hidden shadow-2xl"
      style={{
        width: 240,
        background: '#1e0040',
        border: '1px solid #a78bfa',
        boxShadow: '0 8px 40px rgba(124,58,237,0.5)',
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: 'linear-gradient(135deg, #4c1d95, #2d1b4e)', borderBottom: '1px solid #4c1d95' }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4c1d95)', color: '#fde68a', border: '1px solid #f59e0b' }}
        >
          {name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: '#fde68a' }}>{name}</div>
          <div className="text-[10px]" style={{ color: '#a78bfa' }}>{t('menu.loggedIn')}</div>
        </div>
      </div>

      <div className="py-1">
        {items.map(item => (
          <button
            key={item.href}
            onClick={() => {
              playClick()
              onClose()
              navigate(item.href)
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-all hover:opacity-90"
            style={{ background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#2d1b4e')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="text-white">{item.icon}</span>
            <div>
              <div className="text-sm font-semibold" style={{ color: '#e9d5ff' }}>{item.label}</div>
              <div className="text-[10px] text-white">{item.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="mx-4" style={{ height: 1, background: '#4c1d95' }} />

      <div className="py-1">
        <Form method="post" action="/logout" onSubmit={() => { playClick(); onClose() }}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-all hover:opacity-90"
            style={{ background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,38,38,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={18} className="text-white" />
            <div className="text-sm font-semibold" style={{ color: '#f87171' }}>Logout</div>
          </button>
        </Form>
      </div>
    </div>
  )
}

// Shape of a single bet in the customer's "your bets in this round" list.
type MyLiveBet = {
  id: string
  kind: 'SYMBOL' | 'RANGE' | 'PAIR'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
}

// Recent rolls for the HISTORY sidebar. Self-play list is per-user (rounds
// the customer placed bets in); live list is global so everyone sees the
// same admin-hosted LIVE results. Anonymous visitors get empty arrays here
// and fall back to in-memory session state.
//
// Also returns the currently-open LIVE round (if any) so the LIVE-mode UI
// shows the admin's stream + a server-driven betting countdown rather than
// a hardcoded placeholder + local timer.
export async function loader({ request }: Route.LoaderArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser(request)
  } catch (err) {
    console.error('[home loader] getCurrentUser failed:', err)
  }

  const { prisma } = await import('~/lib/prisma.server')

  // The currently in-flight LIVE round (if any), plus the most recent stream
  // URL from any past round. The fallback URL keeps the customer's video panel
  // populated between rounds — once the host has streamed once, the iframe
  // stays visible (just disabled for betting) until the next round starts.
  const [liveRoundRaw, lastStreamRound] = await Promise.all([
    prisma.gameRound.findFirst({
      where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, streamUrl: true, bettingClosesAt: true, dice1: true, dice2: true, dice3: true },
    }),
    prisma.gameRound.findFirst({
      where: { mode: 'LIVE', streamUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { streamUrl: true },
    }),
  ])
  const liveRound = liveRoundRaw
    ? {
        id: liveRoundRaw.id,
        status: liveRoundRaw.status as 'BETTING' | 'LOCKED' | 'AWAITING_RESULT',
        streamUrl: liveRoundRaw.streamUrl,
        bettingClosesAt: liveRoundRaw.bettingClosesAt?.toISOString() ?? null,
        dice: [
          (liveRoundRaw.dice1 as string | null) ?? null,
          (liveRoundRaw.dice2 as string | null) ?? null,
          (liveRoundRaw.dice3 as string | null) ?? null,
        ] as (string | null)[],
      }
    : null
  const lastStreamUrl = lastStreamRound?.streamUrl ?? null

  if (!user) {
    return {
      selfPlayHistory: [] as SymbolKey[][],
      liveHistory: [] as SymbolKey[][],
      liveRound,
      lastStreamUrl,
      myLiveBets: [] as MyLiveBet[],
    }
  }

  // The customer's own bets in the current LIVE round — populates the
  // "your bets in this round" list shown during the awaiting-result phase.
  const myLiveBets = liveRound
    ? (await prisma.bet.findMany({
        where: { roundId: liveRound.id, userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, amount: true, symbol: true, range: true, pairA: true, pairB: true },
      })).map(b => ({
        id: b.id,
        kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR',
        amount: b.amount,
        symbol: b.symbol as string | null,
        range: b.range as string | null,
        pairA: b.pairA as string | null,
        pairB: b.pairB as string | null,
      }))
    : []

  const [selfPlay, live] = await Promise.all([
    prisma.gameRound.findMany({
      where: {
        mode: 'RANDOM',
        status: 'RESOLVED',
        bets: { some: { userId: user.id } },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 30,
      select: { id: true, dice1: true, dice2: true, dice3: true },
    }),
    prisma.gameRound.findMany({
      where: { mode: 'LIVE', status: 'RESOLVED' },
      orderBy: { resolvedAt: 'desc' },
      take: 30,
      select: { id: true, dice1: true, dice2: true, dice3: true },
    }),
  ])
  function toLower(r: { dice1: string | null; dice2: string | null; dice3: string | null }): SymbolKey[] | null {
    if (!r.dice1 || !r.dice2 || !r.dice3) return null
    return [r.dice1.toLowerCase(), r.dice2.toLowerCase(), r.dice3.toLowerCase()] as SymbolKey[]
  }
  return {
    selfPlayHistory: selfPlay.map(toLower).filter((r): r is SymbolKey[] => r !== null),
    liveHistory: live.map(toLower).filter((r): r is SymbolKey[] => r !== null),
    liveRound,
    lastStreamUrl,
    myLiveBets,
  }
}

export default function FishPrawnCrabGame() {
  const user = useUser()
  const { user: authUser, wallets: serverWallets } = useOutletContext<{ user: SessionUser; wallets: SessionWallets }>()
  const loaderData = useLoaderData<typeof loader>()
  const t = useT()

  // Sync the in-browser user-store with the server's wallet balances whenever
  // they arrive (post-login, after revalidation, etc.). For anonymous visitors
  // we leave the demo defaults alone so they can still try the game.
  useEffect(() => {
    if (serverWallets) hydrateBalances(serverWallets.demo, serverWallets.real)
  }, [serverWallets?.demo, serverWallets?.real])
  const { startRollSound, stopRollSound, playWin, playLose } = useSoundEngine()

  // Display name + initials from the authenticated session. Falls back to the
  // client-side demo user (useful when anonymous visitors land on the game page).
  const isAnonymous = !authUser
  const displayName = authUser
    ? [authUser.firstName, authUser.lastName].filter(Boolean).join(' ') || authUser.tel
    : t('auth.anonymous')
  const initials = authUser
    ? ((authUser.firstName?.[0] ?? '') + (authUser.lastName?.[0] ?? '')).toUpperCase() ||
      authUser.tel.slice(-2)
    : '??'

  const [balance, setBalance] = useState(0)
  useEffect(() => { setBalance(user.balance) }, [user.balance])

  // Fetcher used to persist each completed round (self-play + player-entered live).
  // Skipped for anonymous visitors — they keep playing locally only.
  const playRoundFetcher = useFetcher<{ ok?: boolean; balance?: number; error?: string }>()

  // Login / register modal state + auto-close once the session user materialises.
  const [loginOpen, setLoginOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [loginHint, setLoginHint] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (authUser) {
      setLoginOpen(false)
      setRegisterOpen(false)
    }
  }, [authUser])

  const [currentBets, setCurrentBets] = useState<Bet[]>([])
  const [currentRangeBets, setCurrentRangeBets] = useState<RangeBet[]>([])
  const [currentPairBets, setCurrentPairBets] = useState<PairBet[]>([])
  const [pendingCell, setPendingCell] = useState<number | null>(null)
  const [selectedChip, setSelectedChip] = useState(5_000)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [resultModal, setResultModal] = useState<{
    win: number; betTotal: number; newBalance: number; dice: SymbolKey[]; diceSum: number
  } | null>(null)
  const [diceResults, setDiceResults] = useState<SymbolKey[]>([])
  const [rollingDice, setRollingDice] = useState<SymbolKey[]>([])
  const [isRolling, setIsRolling] = useState(false)
  const [lastWin, setLastWin] = useState(0)
  const [lastBetTotal, setLastBetTotal] = useState(0)
  const [history, setHistory] = useState<SymbolKey[][]>([])
  const [message, setMessage] = useState<string>(t('game.placeBet'))
  const [profileOpen, setProfileOpen] = useState(false)
  const [bgStarted, setBgStarted] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  // Live (streaming) mode — driven by the admin's open round (loaderData.liveRound).
  const [mode, setMode] = useState<'random' | 'live'>('random')
  const liveRound = loaderData.liveRound
  const revalidator = useRevalidator()

  // Locally-mirrored dice for the open round. Initialised from the loader and
  // updated optimistically as the admin reveals each die (round:dice event).
  // Reset whenever the round id changes (new round started, or no round).
  const [revealedDice, setRevealedDice] = useState<(SymbolKey | null)[]>(() =>
    (liveRound?.dice ?? [null, null, null]).map(d => (d ? (d.toLowerCase() as SymbolKey) : null)),
  )
  useEffect(() => {
    setRevealedDice(
      (loaderData.liveRound?.dice ?? [null, null, null]).map(d =>
        d ? (d.toLowerCase() as SymbolKey) : null,
      ),
    )
  }, [loaderData.liveRound?.id])

  // Customer's own bets in the current round — drives the "your bets" list
  // shown during the awaiting-result phase.
  const myLiveBets = loaderData.myLiveBets

  // Settlement modal — populated from the per-user `round:settled` event.
  const [liveSettleModal, setLiveSettleModal] = useState<RoundSettledPayload | null>(null)

  // Tick a "now" clock every second while in LIVE mode so the countdown
  // re-renders without jitter. Stays still in RANDOM mode.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (mode !== 'live') return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [mode])

  // Derived live state.
  const liveTimer = (() => {
    if (!liveRound?.bettingClosesAt) return 0
    const remaining = Math.ceil((new Date(liveRound.bettingClosesAt).getTime() - nowTick) / 1000)
    return Math.max(0, remaining)
  })()
  const livePhase: LivePhase = (() => {
    if (!liveRound) return 'idle'
    if (liveRound.status === 'BETTING' && liveTimer > 0) return 'betting'
    return 'awaiting_result'
  })()

  // Presence: while the customer is in LIVE mode their browser joins the
  // global presence-live channel so the admin Live page can list them as a
  // current viewer. Subscribing to the channel is the only thing required —
  // the members list itself isn't rendered here.
  const presenceChannel = mode === 'live' && !isAnonymous ? PRESENCE_LIVE : null
  usePresenceMembers(presenceChannel)

  // When the admin opens a new LIVE round, refresh our loader so the stream
  // URL + countdown reflect the new round (otherwise we'd keep showing the
  // stale "WAITING FOR RESULT" state from a previous round, or "no round").
  usePusherEvent<RoundStartedPayload>(presenceChannel, 'round:started', () => {
    revalidator.revalidate()
  })
  usePusherEvent<RoundResolvedPayload>(presenceChannel, 'round:resolved', () => {
    revalidator.revalidate()
  })

  // Each die the admin picks (or changes) shows up here in real time.
  usePusherEvent<RoundDicePayload>(presenceChannel, 'round:dice', payload => {
    if (!liveRound || payload.roundId !== liveRound.id) return
    setRevealedDice(prev => {
      const next = [...prev]
      const i = payload.dieIndex - 1
      if (i >= 0 && i < 3) next[i] = payload.symbol.toLowerCase() as SymbolKey
      return next
    })
  })

  // Per-user settlement event — opens the result modal with the customer's
  // personal stake / payout / new balance.
  usePusherEvent<RoundSettledPayload>(
    authUser ? userChannel(authUser.id) : null,
    'round:settled',
    payload => {
      setLiveSettleModal(payload)
    },
  )

  // When the admin resolves (or cancels) the live round, refresh the page
  // loader so the new wallet balance + history land. The admin already pushes
  // a `transaction:updated` companion event for the balance toast.
  usePusherEvent<RoundResolvedPayload>(
    authUser ? userChannel(authUser.id) : null,
    'round:resolved',
    () => { revalidator.revalidate() },
  )
  usePusherEvent<TxUpdatedPayload>(
    authUser ? userChannel(authUser.id) : null,
    'transaction:updated',
    payload => {
      if (payload.id.startsWith('round:')) {
        const positive = payload.note?.toLowerCase().includes('payout')
        toast[positive ? 'success' : 'message'](positive ? 'Live round payout' : 'Live round update', {
          description: `Balance: ${payload.balanceAfter.toLocaleString()} ₭`,
        })
      }
    },
  )

  const [searchParams] = useSearchParams()

  // Grid size tracking for drawing pair connector lines.
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 })

  const ensureBgMusic = useCallback(() => {
    if (!bgStarted && soundEnabled) {
      startBgMusic(0.1)
      setBgStarted(true)
    }
  }, [bgStarted, soundEnabled])

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      if (prev) {
        stopBgMusic()
        setBgStarted(false)
      }
      return !prev
    })
  }, [])

  const totalBet =
    currentBets.reduce((sum, b) => sum + b.amount, 0) +
    currentRangeBets.reduce((sum, b) => sum + b.amount, 0) +
    currentPairBets.reduce((sum, b) => sum + b.amount, 0)
  const getBetAmount = (cell: number) => currentBets.find(b => b.cell === cell)?.amount ?? 0
  const getRangeBetAmount = (range: RangeKey) => currentRangeBets.find(b => b.range === range)?.amount ?? 0
  // Pair amount for a specific cell (not symbol) so only the tapped cell lights up,
  // even when the same symbol appears twice on the board.
  const getPairBetAmount = (cellIdx: number) =>
    currentPairBets.filter(p => p.cellA === cellIdx || p.cellB === cellIdx).reduce((s, p) => s + p.amount, 0)
  const hasAnyBet = currentBets.length > 0 || currentRangeBets.length > 0 || currentPairBets.length > 0
  const diceSum = diceResults.reduce((s, sym) => s + SYMBOL_VALUES[sym], 0)
  const bettingLocked = isRolling || (mode === 'live' && livePhase !== 'betting')

  const placeRangeBet = useCallback((range: RangeKey) => {
    ensureBgMusic()
    if (bettingLocked || balance < selectedChip) return
    soundEnabled && playChipPlace()
    setCurrentRangeBets(prev => {
      const idx = prev.findIndex(b => b.range === range)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], amount: next[idx].amount + selectedChip }
        return next
      }
      return [...prev, { range, amount: selectedChip }]
    })
    setBalance(prev => prev - selectedChip)
  }, [bettingLocked, balance, selectedChip, ensureBgMusic, soundEnabled])

  const placePairBet = useCallback((cA: number, cB: number) => {
    if (balance < selectedChip) return
    const [cellA, cellB] = cA < cB ? [cA, cB] : [cB, cA]
    const a = BOARD_LAYOUT[cellA]
    const b = BOARD_LAYOUT[cellB]
    ensureBgMusic()
    soundEnabled && playChipPlace()
    setCurrentPairBets(prev => {
      const idx = prev.findIndex(p => p.cellA === cellA && p.cellB === cellB)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], amount: next[idx].amount + selectedChip }
        return next
      }
      return [...prev, { a, b, cellA, cellB, amount: selectedChip }]
    })
    setBalance(prev => prev - selectedChip)
  }, [balance, selectedChip, ensureBgMusic, soundEnabled])

  const addSingleChips = useCallback((cell: number, chips: number) => {
    if (chips <= 0) return
    const total = selectedChip * chips
    const symbol = BOARD_LAYOUT[cell]
    ensureBgMusic()
    soundEnabled && playChipPlace()
    setCurrentBets(prev => {
      const i = prev.findIndex(b => b.cell === cell)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], amount: next[i].amount + total }
        return next
      }
      return [...prev, { cell, symbol, amount: total }]
    })
    setBalance(prev => prev - total)
  }, [selectedChip, ensureBgMusic, soundEnabled])

  // Board tap flow:
  //  1st tap on X           → X becomes "pending" (no chip yet, pulsing highlight)
  //  2nd tap on same X      → commit X as SINGLE bet with 1 chip
  //                           (4 taps total = 2 chips, i.e. "double coin")
  //  2nd tap on adjacent Y  → commit PAIR bet (X,Y) with 1 chip (pays 6× if both appear)
  //  2nd tap on non-adj Z   → commit X as single (1 chip), Z becomes new pending
  const handleBoardTap = useCallback((idx: number) => {
    if (bettingLocked) return
    const symbol = BOARD_LAYOUT[idx]

    if (pendingCell === null) {
      if (balance < selectedChip) return
      ensureBgMusic()
      soundEnabled && playClick()
      setPendingCell(idx)
      return
    }

    const pendingSymbol = BOARD_LAYOUT[pendingCell]

    if (pendingCell === idx) {
      // Same cell → single bet with 1 chip. Customer who wants 2 chips taps
      // four times (two full pending→commit cycles).
      setPendingCell(null)
      const chips = balance >= selectedChip ? 1 : 0
      addSingleChips(idx, chips)
      return
    }

    if (areAdjacent(pendingCell, idx) && pendingSymbol !== symbol) {
      const prevIdx = pendingCell
      setPendingCell(null)
      placePairBet(prevIdx, idx)
      return
    }

    // Non-adjacent, or adjacent same-symbol: commit pending as single (1 chip), re-pending
    addSingleChips(pendingCell, 1)
    setPendingCell(idx)
  }, [bettingLocked, balance, selectedChip, pendingCell, ensureBgMusic, soundEnabled, addSingleChips, placePairBet])

  const undoBet = useCallback(() => {
    // Cancel pending first if set — it hasn't placed a chip yet.
    if (pendingCell !== null) {
      soundEnabled && playClick()
      setPendingCell(null)
      return
    }
    if (currentPairBets.length === 0 && currentRangeBets.length === 0 && currentBets.length === 0) return
    ensureBgMusic()
    soundEnabled && playClick()
    if (currentPairBets.length > 0) {
      const last = currentPairBets[currentPairBets.length - 1]
      setCurrentPairBets(prev => {
        const next = [...prev]
        if (last.amount > selectedChip) {
          next[next.length - 1] = { ...last, amount: last.amount - selectedChip }
        } else {
          next.pop()
        }
        return next
      })
    } else if (currentRangeBets.length > 0) {
      const last = currentRangeBets[currentRangeBets.length - 1]
      setCurrentRangeBets(prev => {
        const next = [...prev]
        if (last.amount > selectedChip) {
          next[next.length - 1] = { ...last, amount: last.amount - selectedChip }
        } else {
          next.pop()
        }
        return next
      })
    } else {
      const last = currentBets[currentBets.length - 1]
      setCurrentBets(prev => {
        const next = [...prev]
        if (last.amount > selectedChip) {
          next[next.length - 1] = { ...last, amount: last.amount - selectedChip }
        } else {
          next.pop()
        }
        return next
      })
    }
    setBalance(prev => prev + selectedChip)
  }, [pendingCell, currentBets, currentRangeBets, currentPairBets, selectedChip, ensureBgMusic, soundEnabled])

  // Apply the outcome of a roll (random or live-entered). Payout + state reset.
  const applyResult = useCallback((finalResults: SymbolKey[]) => {
    const sum = finalResults.reduce((s, sym) => s + SYMBOL_VALUES[sym], 0)
    setRollingDice([])
    setDiceResults(finalResults)
    setHistory(prev => [finalResults, ...prev].slice(0, 30))

    let win = 0
    currentBets.forEach(bet => {
      const matches = finalResults.filter(r => r === bet.symbol).length
      if (matches > 0) win += bet.amount * (matches + 1)
    })
    currentRangeBets.forEach(rb => {
      const cfg = RANGE_CONFIG.find(c => c.key === rb.range)!
      if (sum >= cfg.min && sum <= cfg.max) win += rb.amount * cfg.multiplier
    })
    currentPairBets.forEach(pb => {
      if (finalResults.includes(pb.a) && finalResults.includes(pb.b)) {
        win += pb.amount * PAIR_MULTIPLIER
      }
    })

    const betTotal =
      currentBets.reduce((s, b) => s + b.amount, 0) +
      currentRangeBets.reduce((s, b) => s + b.amount, 0) +
      currentPairBets.reduce((s, b) => s + b.amount, 0)
    const newBalance = balance + win

    storeSetBalance(newBalance)
    recordPlay(
      {
        timestamp: Date.now(),
        betAmount: betTotal,
        winAmount: win,
        dice: finalResults,
        bets: currentBets.map(b => ({ symbol: b.symbol, amount: b.amount })),
        rangeBets: currentRangeBets.map(r => ({ range: r.range, amount: r.amount })),
        pairBets: currentPairBets.map(p => ({ a: p.a, b: p.b, amount: p.amount })),
        result: win > 0 ? 'win' : 'loss',
      },
      0,
    )

    setLastWin(win)
    setLastBetTotal(betTotal)
    setBalance(newBalance)

    // Snapshot the bets BEFORE we clear them — the fetcher payload reads from this.
    const snapshot = {
      symbol: currentBets,
      range: currentRangeBets,
      pair: currentPairBets,
    }

    setCurrentBets([])
    setCurrentRangeBets([])
    setCurrentPairBets([])
    setIsRolling(false)

    // Show summary modal unless the round had no bets (e.g. live admin confirmed with zero wagers).
    if (betTotal > 0) {
      setResultModal({ win, betTotal, newBalance, dice: finalResults, diceSum: sum })
    }

    if (win > 0) {
      setMessage(t('game.youWin', { amount: formatAmount(win) }))
      soundEnabled && playWin()
    } else {
      setMessage(t('game.betterLuck'))
      soundEnabled && playLose()
    }

    // Persist the round to the server. Anonymous visitors play purely locally.
    if (authUser && betTotal > 0) {
      const payload = {
        mode: mode === 'live' ? 'LIVE' : 'RANDOM',
        wallet: user.activeWallet === 'real' ? 'REAL' : 'DEMO',
        dice: finalResults.map(s => s.toUpperCase()),
        bets: {
          symbol: snapshot.symbol.map(b => ({
            symbol: b.symbol.toUpperCase(),
            cell: b.cell,
            amount: b.amount,
          })),
          range: snapshot.range.map(b => ({
            range: b.range.toUpperCase(),
            amount: b.amount,
          })),
          pair: snapshot.pair.map(b => ({
            symbolA: b.a.toUpperCase(),
            symbolB: b.b.toUpperCase(),
            cellA: b.cellA,
            cellB: b.cellB,
            amount: b.amount,
          })),
        },
      }
      playRoundFetcher.submit(payload, {
        method: 'post',
        action: '/api/play-round',
        encType: 'application/json',
      })
    }
  }, [currentBets, currentRangeBets, currentPairBets, balance, soundEnabled, playWin, playLose, authUser, mode, user.activeWallet, playRoundFetcher])

  const rollDice = useCallback(() => {
    if (!hasAnyBet || isRolling) return
    ensureBgMusic()
    setPendingCell(null)
    setIsRolling(true)
    setMessage(t('game.rolling'))
    setLastWin(0)
    soundEnabled && startRollSound()

    const rollInterval = setInterval(() => {
      setRollingDice([
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      ])
    }, 80)

    setTimeout(() => {
      clearInterval(rollInterval)
      soundEnabled && stopRollSound()
      const finalResults: SymbolKey[] = [
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      ]
      applyResult(finalResults)
    }, 2000)
  }, [hasAnyBet, isRolling, ensureBgMusic, soundEnabled, startRollSound, stopRollSound, applyResult])

  // LIVE bet submission — sends staged bets up to /api/play-round which
  // attaches them to the admin's open round and debits the stake. No dice
  // come from the customer here; the admin enters dice on the admin Live page
  // and we react to the resulting `round:resolved` event via revalidation.
  const placeLiveBets = useCallback(() => {
    if (mode !== 'live' || livePhase !== 'betting') return
    if (!authUser) {
      setLoginHint(t('auth.signInOrRegister'))
      setLoginOpen(true)
      return
    }
    if (!hasAnyBet) return
    const snapshot = {
      symbol: currentBets,
      range: currentRangeBets,
      pair: currentPairBets,
    }
    const betTotal =
      snapshot.symbol.reduce((s, b) => s + b.amount, 0) +
      snapshot.range.reduce((s, b) => s + b.amount, 0) +
      snapshot.pair.reduce((s, b) => s + b.amount, 0)

    const payload = {
      mode: 'LIVE',
      wallet: user.activeWallet === 'real' ? 'REAL' : 'DEMO',
      bets: {
        symbol: snapshot.symbol.map(b => ({
          symbol: b.symbol.toUpperCase(),
          cell: b.cell,
          amount: b.amount,
        })),
        range: snapshot.range.map(b => ({
          range: b.range.toUpperCase(),
          amount: b.amount,
        })),
        pair: snapshot.pair.map(b => ({
          symbolA: b.a.toUpperCase(),
          symbolB: b.b.toUpperCase(),
          cellA: b.cellA,
          cellB: b.cellB,
          amount: b.amount,
        })),
      },
    }
    playRoundFetcher.submit(payload, {
      method: 'post',
      action: '/api/play-round',
      encType: 'application/json',
    })
    // Optimistic clear — the staged bets already reduced the local balance
    // when chips were placed, so we just need to clear the staged list.
    setCurrentBets([])
    setCurrentRangeBets([])
    setCurrentPairBets([])
    setPendingCell(null)
    setLastBetTotal(betTotal)
    soundEnabled && playClick()
    toast.success('Bets placed', {
      description: `${betTotal.toLocaleString()} ₭ — waiting for the host to enter dice`,
    })
  }, [mode, livePhase, authUser, hasAnyBet, currentBets, currentRangeBets, currentPairBets, user.activeWallet, playRoundFetcher, soundEnabled, t])

  // Show server errors (insufficient balance, no open round, betting closed) as a toast,
  // and revalidate after a successful LIVE submission so myLiveBets reflects the new rows.
  useEffect(() => {
    if (playRoundFetcher.state !== 'idle') return
    const data = playRoundFetcher.data
    if (!data) return
    if (data.error) {
      toast.error('Bet not placed', { description: data.error })
    } else if (data.ok) {
      revalidator.revalidate()
    }
  }, [playRoundFetcher.state, playRoundFetcher.data, revalidator])

  // Mode toggle: switching modes clears any staged bets to avoid mixing
  // RANDOM (client-rolled) and LIVE (server-attached) bets. Switching INTO
  // LIVE also forces a loader revalidation so we pick up the admin's current
  // round state (a `round:started` event might have fired before we joined
  // presence-live, in which case the local snapshot is already stale).
  const toggleMode = useCallback(() => {
    setMode(prev => {
      const next = prev === 'random' ? 'live' : 'random'
      if (next === 'live') revalidator.revalidate()
      return next
    })
    setCurrentBets([])
    setCurrentRangeBets([])
    setCurrentPairBets([])
    setPendingCell(null)
  }, [revalidator])

  // (Webcam getUserMedia removed — stream is now an external iframe embed on user side.)

  // Observe the betting grid's pixel size so we can draw pair connector lines.
  useEffect(() => {
    if (!gridRef.current) return
    const el = gridRef.current
    const update = () => setGridSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const displayDice = isRolling ? rollingDice : diceResults

  // Dice display: 3 dice + SUM badge + win badge. Used in both RANDOM and LIVE modes.
  const diceDisplay = (
    <>
      <div className="flex items-center gap-4">
        {displayDice.length > 0
          ? displayDice.map((sym, i) => (
            <div
              key={i}
              className={`relative overflow-hidden rounded-xl bg-white shadow-2xl ${isRolling ? 'animate-bounce' : ''}`}
              style={{ width: 72, height: 72, border: '1px solid #f59e0b', animationDelay: `${i * 80}ms` }}
            >
              <img src={`/symbols/${sym}.jpg`} alt={sym} className="absolute inset-0 h-full w-full object-contain p-1" />
            </div>
          ))
          : [0, 1, 2].map(i => (
            <div
              key={i}
              className="flex items-center justify-center rounded-xl"
              style={{ width: 72, height: 72, background: '#3b0764', border: '2px dashed #7c3aed' }}
            >
              <span style={{ color: '#7c3aed', fontSize: 28 }}>?</span>
            </div>
          ))}
      </div>
      {!isRolling && diceResults.length > 0 && (
        <div
          className="rounded-full px-4 py-0.5 text-xs font-bold tracking-widest"
          style={{ background: 'rgba(30,0,64,0.6)', color: '#fde68a', border: '1px solid #a78bfa' }}
        >
          SUM: {diceSum}
        </div>
      )}
      {!isRolling && lastWin > 0 && diceResults.length > 0 && (
        <div
          className="rounded-full px-5 py-1 text-sm font-bold animate-pulse"
          style={{ background: 'rgba(22,163,74,0.25)', color: '#4ade80', border: '1px solid #4ade80' }}
        >
          +{formatAmount(lastWin)} coins!
        </div>
      )}
    </>
  )

  // (Host result entry lives on the admin Live page now — customers just bet.)

  return (
    <div
      className="min-h-screen font-sans"
      style={{
        background: `
          radial-gradient(ellipse at 20% 30%, rgba(167,139,250,0.18) 0%, transparent 55%),
          radial-gradient(ellipse at 80% 70%, rgba(245,158,11,0.12) 0%, transparent 55%),
          radial-gradient(ellipse at 50% 50%, rgba(109,40,217,0.35) 0%, transparent 80%),
          repeating-linear-gradient(
            45deg,
            transparent,
            transparent 28px,
            rgba(255,255,255,0.025) 28px,
            rgba(255,255,255,0.025) 30px
          ),
          linear-gradient(160deg, #3b0764 0%, #5b21b6 35%, #7c3aed 65%, #4c1d95 100%)
        `,
        minHeight: '100vh',
      }}
      onClick={ensureBgMusic}
    >
      <header
        className="flex items-center justify-between px-4 py-2"
        style={{ background: '#1e0040', borderBottom: '1px solid #a78bfa' }}
      >
        <div className="relative">
          {isAnonymous ? (
            // Unauthenticated: placeholder + quick Sign-in button that opens the modal.
            <button
              type="button"
              onClick={() => {
                playClick()
                ensureBgMusic()
                setLoginHint(undefined)
                setLoginOpen(true)
              }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 transition-all hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #4c1d95, #2d1b4e)',
                border: '1px dashed #a78bfa',
              }}
              title={t('auth.signInOrRegister')}
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: '#2d1b4e', color: '#a78bfa', border: '1px dashed #a78bfa' }}
              >
                👤
              </div>
              <span className="hidden sm:inline text-sm font-semibold" style={{ color: '#c4b5fd' }}>
                {displayName}
              </span>
              <span className="hidden sm:inline rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: '#7c3aed', color: '#fff' }}>
                {t('auth.signIn')}
              </span>
            </button>
          ) : (
            <>
              <button
                onClick={() => { playClick(); ensureBgMusic(); setProfileOpen(v => !v) }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 transition-all hover:opacity-90"
                style={{
                  background: profileOpen ? '#4c1d95' : 'linear-gradient(135deg, #4c1d95, #2d1b4e)',
                  border: '1px solid #7c3aed',
                }}
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #b45309)', color: '#1e0040' }}
                >
                  {initials}
                </div>
                <span className="hidden sm:inline text-sm font-semibold max-w-[90px] truncate" style={{ color: '#e9d5ff' }}>
                  {displayName}
                </span>
                <svg
                  className="hidden sm:block transition-transform"
                  style={{ transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: '#a78bfa' }}
                  width="12" height="12" viewBox="0 0 12 12" fill="currentColor"
                >
                  <path d="M6 8L1 3h10L6 8z" />
                </svg>
              </button>
              {profileOpen && (
                <ProfileDropdown name={displayName} onClose={() => setProfileOpen(false)} />
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { playClick(); toggleMode() }}
            className="rounded-full px-3 py-1.5 text-xs font-bold tracking-widest"
            style={{
              background: mode === 'live'
                ? 'linear-gradient(180deg, #dc2626 0%, #7f1d1d 100%)'
                : 'linear-gradient(180deg, #7c3aed 0%, #4c1d95 100%)',
              color: '#fff',
              border: `1px solid ${mode === 'live' ? '#fca5a5' : '#a78bfa'}`,
            }}
            title={mode === 'live' ? t('game.toggleToRandom') : t('game.toggleToLive')}
          >
            {mode === 'live' ? t('game.modeLive') : t('game.modeSelf')}
          </button>
          <button
            onClick={() => { playClick(); ensureBgMusic() }}
            className="hidden md:inline-flex rounded-full px-4 py-1.5 text-xs font-bold"
            style={{ background: 'linear-gradient(180deg, #16a34a 0%, #14532d 100%)', color: '#bbf7d0', border: '1px solid #4ade80' }}
          >
            {t('game.dailyBonus')}
          </button>
          {mode === 'live' ? (
            <span
              className="text-sm font-bold tracking-widest hidden sm:block rounded-full px-3 py-1"
              style={{
                background: livePhase === 'betting'
                  ? (liveTimer <= 10 ? 'rgba(220,38,38,0.25)' : 'rgba(22,163,74,0.25)')
                  : 'rgba(234,88,12,0.25)',
                color: livePhase === 'betting'
                  ? (liveTimer <= 10 ? '#fca5a5' : '#4ade80')
                  : '#fdba74',
                border: `1px solid ${livePhase === 'betting' ? (liveTimer <= 10 ? '#fca5a5' : '#4ade80') : '#fb923c'}`,
              }}
            >
              {livePhase === 'betting' ? `⏱ ${liveTimer}s OPEN` : '🔒 LOCKED — ENTER RESULT'}
            </span>
          ) : (
            <span
              className="text-sm font-bold tracking-wide hidden sm:block"
              style={{ color: diceResults.length > 0 && !isRolling && lastWin > 0 ? '#4ade80' : '#e9d5ff' }}
            >
              {message}
            </span>
          )}
          <button
            onClick={() => { playClick(); ensureBgMusic() }}
            className="hidden md:inline-flex rounded-full px-4 py-1.5 text-xs font-bold"
            style={{ background: 'linear-gradient(180deg, #16a34a 0%, #14532d 100%)', color: '#bbf7d0', border: '1px solid #4ade80' }}
          >
            {t('game.timeBonus')}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitch variant="pill" />
          <button
            onClick={() => { toggleSound() }}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#4c1d95', border: '1px solid #6d28d9' }}
            title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
          >
            {soundEnabled ? (
              <Volume2 size={14} className='text-white' />
            ) : (
              <VolumeOff size={14} className='text-red-500' />
            )}
          </button>
          {/* Wallet toggle: anonymous users cannot use REAL — tapping opens the login modal. */}
          <button
            onClick={() => {
              soundEnabled && playClick()
              ensureBgMusic()
              if (isAnonymous) {
                setLoginHint(t('auth.signInToUseRealWallet'))
                setLoginOpen(true)
                return
              }
              const next = user.activeWallet === 'demo' ? 'real' : 'demo'
              // Clear in-progress bets from the outgoing wallet (they belong to the old balance).
              setCurrentBets([])
              setCurrentRangeBets([])
              setCurrentPairBets([])
              setPendingCell(null)
              switchWallet(next)
              setBalance(user.balances[next])
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest transition-opacity hover:opacity-90"
            style={{
              background: user.activeWallet === 'demo'
                ? 'linear-gradient(135deg, #4c1d95, #2d1b4e)'
                : 'linear-gradient(135deg, #b45309, #78350f)',
              color: user.activeWallet === 'demo' ? '#c4b5fd' : '#fde68a',
              border: `1px ${user.activeWallet === 'demo' ? 'dashed #a78bfa' : 'solid #fcd34d'}`,
            }}
            title={`Current wallet: ${user.activeWallet.toUpperCase()} — click to switch`}
          >
            {user.activeWallet === 'demo' ? 'DEMO' : 'REAL'}
          </button>
          <span className="text-lg font-bold tracking-wider" style={{ color: '#fde68a' }}>
            {balance.toLocaleString()} ₭
          </span>
          {/* {user.activeWallet === 'demo' && (
            <button
              onClick={() => {
                soundEnabled && playCoin()
                ensureBgMusic()
                setCurrentBets([])
                setCurrentRangeBets([])
                setCurrentPairBets([])
                setPendingCell(null)
                resetDemoBalance()
                setBalance(DEMO_RESET_AMOUNT)
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                border: '1px dashed #4ade80',
              }}
              title={`Reset demo balance to ${DEMO_RESET_AMOUNT.toLocaleString()} ₭`}
            >
              +1M
            </button>
          )} */}
        </div>
      </header>
      <main className="flex h-[calc(100vh-52px)] overflow-hidden">
        <aside
          className="hidden md:flex flex-col w-[15%] overflow-y-auto"
          style={{ background: '#4c1d95', borderRight: '1px solid #a78bfa' }}
        >
          <div
            className="py-2 text-center text-[10px] font-bold tracking-wider sticky top-0"
            style={{ color: '#e9d5ff', borderBottom: '1px solid #6d28d9', background: '#4c1d95' }}
          >
            {t('game.history')}
          </div>
          <div className="flex flex-col gap-1 p-1">
            {(() => {
              // Authed users see DB-backed history filtered by current mode;
              // anonymous visitors fall back to in-memory session rolls. Cap
              // the sidebar to the 10 most recent rolls so it stays scannable.
              const serverList = mode === 'live' ? loaderData.liveHistory : loaderData.selfPlayHistory
              const list = (authUser ? serverList : history).slice(0, 10)
              if (list.length === 0) {
                return (
                  <p className="text-center text-[9px] py-4" style={{ color: '#6d28d9' }}>
                    {mode === 'live' ? t('game.noLiveRolls') : t('game.noRolls')}
                  </p>
                )
              }
              return list.map((roll, idx) => (
                <div
                  key={idx}
                  className="flex gap-0.5 rounded p-1"
                  style={{ background: '#5b21b6', border: '1px solid #7c3aed' }}
                >
                  {roll.map((sym, i) => (
                    <div key={i} className="relative mx-auto h-[56px] w-[56px] rounded-lg overflow-hidden bg-white">
                      <img src={`/symbols/${sym}.jpg`} alt={sym} className="absolute inset-0 h-full w-full object-contain" />
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          {/* LIVE mode (spectator): centered stream iframe + countdown driven by the
              admin's open round. The admin Live page sets the stream URL + closes-at. */}
          {mode === 'live' ? (
            <div
              className="flex shrink-0 flex-col items-center gap-3 px-2 py-3 md:px-4"
              style={{ background: '#4c1d95', borderBottom: '1px solid #a78bfa' }}
            >
              <div
                className="relative w-full max-h-[38vh] overflow-hidden rounded-lg bg-black md:max-h-[45vh]"
                style={{ maxWidth: 720, aspectRatio: '16/9', border: '1px solid #a78bfa' }}
              >
                {(() => {
                  // Prefer the active round's stream URL; otherwise fall back
                  // to the last known stream URL so the video stays visible
                  // between rounds (the betting controls stay disabled until
                  // a new round opens, but the host's feed keeps playing).
                  const embed = liveEmbedSrc(liveRound?.streamUrl ?? loaderData.lastStreamUrl ?? null)
                  if (!embed) {
                    return (
                      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: '#a78bfa' }}>
                        Waiting for the host to set the stream…
                      </div>
                    )
                  }
                  return embed.kind === 'video' ? (
                    <video
                      src={embed.src}
                      className="h-full w-full"
                      controls
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <iframe
                      src={embed.src}
                      className="h-full w-full"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      title="Live stream"
                    />
                  )
                })()}
                <div
                  className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest"
                  style={{ background: 'rgba(220,38,38,0.9)', color: '#fff' }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </div>
                <div
                  className="absolute top-2 right-2 rounded-md px-3 py-1 text-xs font-bold tracking-widest"
                  style={{
                    background: livePhase === 'betting'
                      ? (liveTimer <= 10 ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)')
                      : livePhase === 'awaiting_result'
                        ? 'rgba(234,88,12,0.9)'
                        : 'rgba(76,29,149,0.9)',
                    color: '#fff',
                  }}
                >
                  {livePhase === 'betting' ? `⏱ ${liveTimer}s BETTING` : livePhase === 'awaiting_result' ? '🔒 WAITING FOR RESULT' : '⏸ ROUND NOT STARTED'}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 py-4"
              style={{ background: '#4c1d95', borderBottom: '1px solid #a78bfa', minHeight: '148px' }}
            >
              {diceDisplay}
            </div>
          )}

          <div className="flex-1 p-3 overflow-auto" style={{ background: '#7c3aed' }}>
            {mode === 'live' && livePhase !== 'betting' ? (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="text-sm font-semibold text-center" style={{ color: '#c4b5fd' }}>
                  {livePhase === 'idle'
                    ? '⏸ Waiting for the host to start the next round…'
                    : '🔒 Betting closed — host is entering the result.'}
                </div>
                {livePhase === 'awaiting_result' && (
                  <>
                    <DiceReveal dice={revealedDice} />
                    {myLiveBets.length > 0 && <MyBetsList bets={myLiveBets} />}
                  </>
                )}
              </div>
            ) : (<>
              <div
                ref={gridRef}
                className="relative mx-auto grid grid-cols-4 gap-2"
                style={{ maxWidth: 560 }}
              >
                {/* SVG overlay: connector line per pair, colored per (cellA, cellB) */}
                {currentPairBets.length > 0 && gridSize.w > 0 && gridSize.h > 0 && (() => {
                  const GAP = 8  // must match gap-2 (0.5rem)
                  const cols = 4, rows = 2
                  const cellW = (gridSize.w - (cols - 1) * GAP) / cols
                  const cellH = (gridSize.h - (rows - 1) * GAP) / rows
                  const centerOf = (i: number) => ({
                    x: (i % cols) * (cellW + GAP) + cellW / 2,
                    y: Math.floor(i / cols) * (cellH + GAP) + cellH / 2,
                  })
                  return (
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={gridSize.w}
                      height={gridSize.h}
                      style={{ zIndex: 20 }}
                    >
                      {currentPairBets.map(pb => {
                        const c1 = centerOf(pb.cellA)
                        const c2 = centerOf(pb.cellB)
                        const color = pairColor(pb.cellA, pb.cellB)
                        const won = !isRolling && diceResults.length > 0 &&
                          diceResults.includes(pb.a) && diceResults.includes(pb.b)
                        return (
                          <g key={`line-${pb.cellA}-${pb.cellB}`}>
                            <line
                              x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                              stroke={won ? '#facc15' : color}
                              strokeWidth={won ? 6 : 4}
                              strokeLinecap="round"
                              opacity={won ? 0.95 : 0.8}
                            />
                            <circle cx={c1.x} cy={c1.y} r={6}
                              fill={won ? '#facc15' : color} opacity="0.95" />
                            <circle cx={c2.x} cy={c2.y} r={6}
                              fill={won ? '#facc15' : color} opacity="0.95" />
                          </g>
                        )
                      })}
                    </svg>
                  )
                })()}
                {BOARD_LAYOUT.map((symbol, idx) => {
                  const bet = getBetAmount(idx)
                  const pairBet = getPairBetAmount(idx)
                  const isWinner = diceResults.includes(symbol) && !isRolling
                  const isPending = pendingCell === idx
                  const hasSingle = bet > 0
                  const hasPair = pairBet > 0

                  // Border: pending > winner > both > single > pair > none.
                  let borderColor = 'transparent'
                  let borderWidth = 2
                  let glow = '0 2px 6px rgba(0,0,0,0.2)'
                  if (isPending) {
                    borderColor = '#facc15'; borderWidth = 3
                    glow = 'inset 0 0 24px rgba(250,204,21,0.5)'
                  } else if (isWinner) {
                    borderColor = '#facc15'; borderWidth = 3
                    glow = '0 0 18px rgba(250,204,21,0.6)'
                  } else if (hasSingle && hasPair) {
                    borderColor = '#a855f7'; borderWidth = 3  // purple = both
                    glow = '0 0 14px rgba(168,85,247,0.55)'
                  } else if (hasSingle) {
                    borderColor = '#dc2626'; borderWidth = 3  // red = single
                    glow = '0 0 14px rgba(220,38,38,0.5)'
                  } else if (hasPair) {
                    borderColor = '#3b82f6'; borderWidth = 3  // blue = pair
                    glow = '0 0 14px rgba(59,130,246,0.5)'
                  }

                  return (
                    <button
                      key={`${symbol}-${idx}`}
                      onClick={() => handleBoardTap(idx)}
                      disabled={bettingLocked || (pendingCell === null && balance < selectedChip)}
                      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl transition-all group ${isPending ? 'animate-pulse' : ''}`}
                      style={{
                        aspectRatio: '1',
                        border: `${borderWidth}px solid ${borderColor}`,
                        background: isWinner
                          ? 'rgba(250,204,21,0.4)'
                          : isPending
                            ? 'rgba(250,204,21,0.18)'
                            : hasPair && hasSingle
                              ? 'rgba(216,180,254,0.3)'
                              : hasPair
                                ? 'rgba(147,197,253,0.3)'
                                : hasSingle
                                  ? 'rgba(252,165,165,0.3)'
                                  : '#ffffff',
                        boxShadow: glow,
                        cursor: isRolling ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div className="relative w-full h-full p-2">
                        <img
                          src={`/symbols/${symbol}.jpg`}
                          alt={SYMBOL_NAMES[symbol]}
                          loading="eager"
                          className="absolute inset-0 h-full w-full object-contain p-2 group-hover:scale-105 transition-transform"
                        />
                      </div>

                      <div
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: 'rgba(76,29,149,0.92)', color: '#fde68a', border: '1px solid #a78bfa' }}
                      >
                        {SYMBOL_VALUES[symbol]}
                      </div>

                      {bet > 0 && (
                        <div
                          className="absolute top-1.5 right-1.5 flex h-7 min-w-[36px] items-center justify-center rounded-full px-2 font-bold shadow-lg text-[10px] whitespace-nowrap"
                          style={{
                            background: 'linear-gradient(135deg, #dc2626, #991b1b)',
                            color: '#fff',
                            border: '1px solid #fca5a5',
                          }}
                        >
                          {bet.toLocaleString()}
                        </div>
                      )}

                      {pairBet > 0 && (
                        <div
                          className="absolute top-1.5 left-1.5 flex h-6 min-w-[32px] items-center justify-center rounded-full px-1.5 font-bold shadow-lg text-[9px] whitespace-nowrap"
                          style={{
                            background: 'linear-gradient(135deg, #2563eb, #1e3a8a)',
                            color: '#fff',
                            border: '1px solid #60a5fa',
                          }}
                          title="Pair bet"
                        >
                          {pairBet.toLocaleString()}
                        </div>
                      )}

                      {isWinner && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{ boxShadow: 'inset 0 0 22px rgba(250,204,21,0.55)' }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Pair bets summary + hint */}
              <div className="mx-auto mt-2 flex flex-col items-center gap-1" style={{ maxWidth: 560 }}>
                {currentPairBets.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {currentPairBets.map(p => {
                      const hasA = diceResults.includes(p.a)
                      const hasB = diceResults.includes(p.b)
                      const won = !isRolling && diceResults.length > 0 && hasA && hasB
                      const color = pairColor(p.cellA, p.cellB)
                      return (
                        <div
                          key={`${p.cellA}-${p.cellB}`}
                          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                          style={{
                            background: won ? 'rgba(250,204,21,0.25)' : '#1e0040',
                            border: `1px solid ${won ? '#facc15' : color}`,
                            color: won ? '#fde68a' : '#e9d5ff',
                          }}
                        >
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: won ? '#facc15' : color }} />
                          <span>{SYMBOL_VALUES[p.a]} + {SYMBOL_VALUES[p.b]}</span>
                          <span style={{ color: won ? '#fde68a' : color }}>×{PAIR_MULTIPLIER}</span>
                          <span>{p.amount.toLocaleString()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="text-[10px] text-center" style={{ color: '#c4b5fd' }}>
                  {t('game.tapAdjacent')}
                </div>
              </div>

              {/* Range betting: LOW / MIDDLE / HIGH (based on dice sum) */}
              <div className="mx-auto mt-3 grid grid-cols-3 gap-2" style={{ maxWidth: 560 }}>
                {RANGE_CONFIG.map(r => {
                  const bet = getRangeBetAmount(r.key)
                  const isWinner = !isRolling && diceResults.length > 0 && diceSum >= r.min && diceSum <= r.max
                  return (
                    <button
                      key={r.key}
                      onClick={() => placeRangeBet(r.key)}
                      disabled={bettingLocked || balance < selectedChip}
                      className="relative flex flex-col items-center justify-center rounded-md py-2 sm:py-3 transition-all disabled:opacity-50"
                      style={{
                        background: isWinner ? 'rgba(250,204,21,0.35)' : r.bg,
                        border: `1px solid ${isWinner ? '#facc15' : r.border}`,
                        boxShadow: isWinner ? '0 0 20px rgba(250,204,21,0.55)' : '0 2px 8px rgba(0,0,0,0.3)',
                        color: r.color,
                        cursor: bettingLocked || balance < selectedChip ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div className="text-sm font-semibold tracking-widest">
                        {r.key === 'low' ? t('game.low') : r.key === 'middle' ? t('game.middle') : t('game.high')}{' '}
                        <span className="text-xs opacity-90">({r.range})</span>
                      </div>
                      <div className="text-[10px] opacity-75">{t('game.pays', { x: r.multiplier })}</div>
                      {bet > 0 && (
                        <div
                          className="absolute top-1.5 right-1.5 flex h-7 min-w-[36px] items-center justify-center rounded-full px-2 font-bold shadow-lg text-[10px] whitespace-nowrap"
                          style={{
                            background: 'linear-gradient(135deg, #dc2626, #991b1b)',
                            color: '#fff',
                            border: '1px solid #fca5a5',
                          }}
                        >
                          {bet.toLocaleString()}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>)}
          </div>

          <div
            className={`flex flex-wrap items-center justify-between gap-4 px-4 py-6 pb-28 md:hidden ${mode === 'live' && livePhase !== 'betting' ? 'hidden' : ''}`}
            style={{ background: '#1e0040', borderTop: '1px solid #a78bfa' }}
          >
            {/* LEFT: chip / price input */}
            <div className="flex items-center gap-1.5">
              {CHIP_CONFIG.map(chip => (
                <button
                  key={chip.value}
                  onClick={() => { soundEnabled && playCoin(); ensureBgMusic(); setSelectedChip(chip.value) }}
                  className={`relative flex h-12 w-12 flex-col items-center justify-center rounded-full bg-gradient-to-b ${chip.colors} font-bold text-white transition-all`}
                  style={{
                    border: `1px solid ${chip.border}`,
                    transform: selectedChip === chip.value ? 'scale(1.1)' : 'scale(1)',
                    boxShadow: selectedChip === chip.value ? `0 0 14px ${chip.border}` : '0 2px 6px rgba(0,0,0,0.5)',
                    fontSize: chip.value >= 100_000 ? 9 : 10,
                  }}
                >
                  {chip.label}
                </button>
              ))}
              {(() => {
                const isCustomChip = !CHIP_CONFIG.some(c => c.value === selectedChip)
                return (
                  <button
                    onClick={() => {
                      soundEnabled && playClick()
                      ensureBgMusic()
                      setCustomAmount(isCustomChip ? String(selectedChip) : '')
                      setCustomModalOpen(true)
                    }}
                    className="relative flex h-12 w-12 flex-col items-center justify-center rounded-full bg-gradient-to-b from-purple-600 to-purple-900 font-bold text-white transition-all"
                    style={{
                      border: '1px solid #c084fc',
                      transform: isCustomChip ? 'scale(1.22)' : 'scale(1)',
                      boxShadow: isCustomChip ? '0 0 14px #c084fc' : '0 2px 6px rgba(0,0,0,0.5)',
                      fontSize: isCustomChip ? (selectedChip >= 10_000 ? 9 : 10) : 14,
                    }}
                    title="Custom amount"
                  >
                    {isCustomChip ? formatAmount(selectedChip) : <Pencil size={16} />}
                  </button>
                )
              })()}
            </div>

            {/* RIGHT: UNDO button */}
            <button
              onClick={undoBet}
              disabled={bettingLocked || (!hasAnyBet && pendingCell === null)}
              className="rounded-xl px-5 py-2.5 text-sm font-bold tracking-widest transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #f59e0b, #b45309)', color: '#1e0040', border: '1px solid #fcd34d' }}
            >
              Undo
            </button>
          </div>
        </div>

        {/* Floating action button on mobile (right aside is hidden < md). */}
        {mode === 'random' ? (
          <button
            onClick={rollDice}
            disabled={isRolling || !hasAnyBet}
            className="fixed bottom-4 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full font-bold tracking-widest text-sm transition-all disabled:opacity-40 md:hidden"
            style={{
              background: isRolling
                ? 'linear-gradient(135deg, #15803d, #14532d)'
                : 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff',
              border: '2px solid #14532d',
              boxShadow: isRolling ? '0 4px 12px rgba(0,0,0,0.4)' : '0 4px 20px rgba(22,163,74,0.6)',
            }}
            aria-label="Roll dice"
          >
            {isRolling ? '...' : 'ROLL'}
          </button>
        ) : livePhase === 'betting' && (
          <button
            onClick={placeLiveBets}
            disabled={!hasAnyBet || playRoundFetcher.state !== 'idle'}
            className="fixed bottom-4 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full font-bold tracking-widest text-xs transition-all disabled:opacity-40 md:hidden"
            style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff',
              border: '2px solid #f59e0b',
              boxShadow: '0 4px 20px rgba(22,163,74,0.6)',
            }}
            aria-label="Place live bets"
          >
            OKAY
          </button>
        )}

        <aside
          className="hidden md:flex flex-col items-center py-4 px-2 gap-4 w-[15%] overflow-y-auto"
          style={{ background: '#4c1d95', borderLeft: '1px solid #a78bfa' }}
        >
          <div className="flex flex-col gap-3 w-full">
            {[
              { label: 'LAST BET', value: lastBetTotal.toLocaleString(), color: '#fde68a' },
              { label: 'LAST WIN', value: lastWin.toLocaleString(), color: lastWin > 0 ? '#4ade80' : '#6d28d9' },
              { label: 'CUR BET', value: totalBet.toLocaleString(), color: '#fde68a' },
              { label: 'BALANCE', value: balance.toLocaleString(), color: '#fde68a' },
            ].map((stat, i, arr) => (
              <div key={stat.label}>
                <div className="text-center">
                  <div className="text-[9px] font-bold tracking-widest mb-0.5" style={{ color: '#c4b5fd' }}>{stat.label}</div>
                  <div className="text-sm font-bold" style={{ color: stat.color }}>{stat.value}</div>
                </div>
                {i < arr.length - 1 && <div className="h-px mt-2" style={{ background: '#6d28d9' }} />}
              </div>
            ))}
          </div>

          {/* Chips (price input) + UNDO — shown on md+ where the bottom bar is hidden */}
          {(mode === 'random' || livePhase === 'betting') && (
            <div className="flex w-full flex-col items-center gap-3">
              <div className="h-px w-full" style={{ background: '#6d28d9' }} />
              <div className="grid w-full grid-cols-2 justify-items-center gap-2">
                {CHIP_CONFIG.map(chip => (
                  <button
                    key={chip.value}
                    onClick={() => { soundEnabled && playCoin(); ensureBgMusic(); setSelectedChip(chip.value) }}
                    className={`relative flex h-11 w-full items-center justify-center rounded-xl font-bold text-white transition-all`}
                    style={{
                      border: selectedChip === chip.value ? "2px solid white" : `1px solid gray`,
                      boxShadow: selectedChip === chip.value ? `0 0 12px ${chip.border}` : '0 2px 6px rgba(0,0,0,0.5)',
                      fontSize: chip.value >= 100_000 ? 9 : 10,
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
                {(() => {
                  const isCustomChip = !CHIP_CONFIG.some(c => c.value === selectedChip)
                  return (
                    <button
                      onClick={() => {
                        soundEnabled && playClick()
                        ensureBgMusic()
                        setCustomAmount(isCustomChip ? String(selectedChip) : '')
                        setCustomModalOpen(true)
                      }}
                      className="col-span-2 flex h-10 w-full items-center justify-center gap-1 rounded-xl bg-gradient-to-b from-purple-600 to-purple-900 text-[11px] font-bold text-white"
                      style={{
                        border: '1px solid #c084fc',
                      }}
                      title="Custom amount"
                    >
                      {isCustomChip ? formatAmount(selectedChip) : <><Pencil size={12} /> CUSTOM</>}
                    </button>
                  )
                })()}
              </div>
              <button
                onClick={undoBet}
                disabled={bettingLocked || (!hasAnyBet && pendingCell === null)}
                className="flex items-center justify-center gap-2 bg-red-500 w-full rounded-xl p-3 text-xs font-bold tracking-widest transition-opacity disabled:opacity-40 text-white"
              >
                <Undo size={14} />
                UNDO
              </button>
            </div>
          )}

          <div className="mt-auto">
            {mode === 'random' ? (
              <button
                onClick={rollDice}
                disabled={isRolling || !hasAnyBet}
                className="flex h-20 w-20 items-center justify-center rounded-full font-bold tracking-widest text-lg transition-all disabled:opacity-40"
                style={{
                  background: isRolling
                    ? 'linear-gradient(135deg, #15803d, #14532d)'
                    : 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  border: '4px solid #f59e0b',
                  boxShadow: isRolling ? 'none' : '0 0 22px rgba(22,163,74,0.55)',
                  transform: isRolling ? 'scale(0.95)' : 'scale(1)',
                }}
              >
                {isRolling ? '...' : 'ROLL'}
              </button>
            ) : livePhase === 'betting' ? (
              <button
                onClick={placeLiveBets}
                disabled={!hasAnyBet || playRoundFetcher.state !== 'idle'}
                className="flex h-20 w-20 flex-col items-center justify-center rounded-full text-center font-bold tracking-widest text-[10px] transition-all disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  border: '4px solid #f59e0b',
                  boxShadow: '0 0 22px rgba(22,163,74,0.55)',
                }}
                title="Place your bets in this round"
              >
                <span className="text-sm">OKAY</span>
                <span className="opacity-80">{liveTimer}s</span>
              </button>
            ) : (
              <div
                className="flex h-20 w-20 flex-col items-center justify-center rounded-full text-center font-bold tracking-widest text-[9px]"
                style={{
                  background: 'linear-gradient(135deg, #b45309, #78350f)',
                  color: '#fde68a',
                  border: '4px solid #f59e0b',
                  boxShadow: '0 0 22px rgba(234,88,12,0.55)',
                }}
                title="Waiting for the host"
              >
                <span>WAITING</span>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Custom chip amount modal */}
      {customModalOpen && (() => {
        const n = Number(customAmount)
        const trimmed = customAmount.trim()
        const error = trimmed === '' ? null
          : !Number.isFinite(n) ? 'Enter a valid number.'
            : !Number.isInteger(n) ? 'Enter a whole number.'
              : n < 1 ? 'Amount must be at least 1 ₭.'
                : n > MAX_CHIP ? `Maximum ${MAX_CHIP.toLocaleString()} ₭.`
                  : null
        const canSubmit = !error && trimmed !== ''
        const submit = () => {
          if (!canSubmit) return
          setSelectedChip(Math.floor(n))
          setCustomModalOpen(false)
          soundEnabled && playCoin()
        }
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(15,0,32,0.82)' }}
            onClick={() => setCustomModalOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: 'linear-gradient(135deg, #3b0764, #1e0040)',
                border: '1px solid #a78bfa',
                boxShadow: '0 10px 40px rgba(124,58,237,0.5)',
              }}
            >
              <div className="mb-1 text-lg font-bold" style={{ color: '#fde68a' }}>Custom Chip Amount</div>
              <div className="mb-4 text-xs" style={{ color: '#c4b5fd' }}>
                Enter any amount from 1 up to {MAX_CHIP.toLocaleString()} ₭.
              </div>
              <input
                type="number"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit()
                  if (e.key === 'Escape') setCustomModalOpen(false)
                }}
                autoFocus
                min={1}
                max={MAX_CHIP}
                step={1}
                placeholder={`1 – ${MAX_CHIP.toLocaleString()}`}
                className="w-full rounded-lg px-4 py-3 text-lg font-bold outline-none"
                style={{ background: '#2d1b4e', color: '#fde68a', border: `1px solid ${error ? '#f87171' : '#7c3aed'}` }}
              />
              <div className="mt-2 min-h-[16px] text-xs font-semibold" style={{ color: error ? '#f87171' : '#a78bfa' }}>
                {error ?? (trimmed ? `Preview: ${Number(trimmed).toLocaleString()} ₭` : '\u00a0')}
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setCustomModalOpen(false)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                  style={{ background: '#4c1d95', color: '#c4b5fd', border: '1px solid #6d28d9' }}
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-opacity disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', border: '1px solid #4ade80' }}
                >
                  Set Chip
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Round result modal — title, result, net amount, total balance, continue. */}
      {resultModal && (() => {
        const net = resultModal.win - resultModal.betTotal
        const isWin = net > 0
        const isEven = net === 0
        const amountText = isEven ? '0' : `${isWin ? '+' : '-'}${Math.abs(net).toLocaleString()}`
        const accent = isWin ? '#4ade80' : isEven ? '#fde68a' : '#f87171'
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(15,0,32,0.82)' }}
            onClick={() => setResultModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-md p-6 bg-white"
            >
              {/* Title */}
              <div className="text-center text-xs font-bold tracking-widest text-gray-500">
                ROUND RESULT
              </div>

              {/* Result */}
              <div
                className="mt-2 text-center text-2xl font-bold tracking-widest"
                style={{ color: accent }}
              >
                {isWin ? '🎉 YOU WIN!' : isEven ? 'BREAK EVEN' : '💔 YOU LOST'}
              </div>

              {/* +amount or -amount */}
              <div
                className="mt-4 text-center text-4xl font-bold"
                style={{ color: accent }}
              >
                {amountText}
              </div>

              <div className='w-full border-1 border-primary mt-4'></div>

              {/* Total balance */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs font-bold tracking-widest">
                  TOTAL BALANCE
                </span>
                <span className="text-xl font-bold">
                  {resultModal.newBalance.toLocaleString()}
                </span>
              </div>

              {/* Continue */}
              <button
                onClick={() => setResultModal(null)}
                className="mt-5 w-full rounded-xl py-3 text-sm font-bold tracking-widest transition-opacity hover:opacity-90 border"
                autoFocus
              >
                CONTINUE
              </button>
            </div>
          </div>
        )
      })()}

      {/* LIVE settlement modal — fired by the per-user `round:settled` event
          right after the admin clicks SUMMARY on the Live page. Shows the
          customer's personal stake, payout, net, and post-settlement balance. */}
      {liveSettleModal && (() => {
        const m = liveSettleModal
        const isWin = m.net > 0
        const isEven = m.net === 0
        const amountText = isEven ? '0' : `${isWin ? '+' : '-'}${Math.abs(m.net).toLocaleString()}`
        const accent = isWin ? '#4ade80' : isEven ? '#fde68a' : '#f87171'
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(15,0,32,0.82)' }}
            onClick={() => setLiveSettleModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-md p-6 bg-white"
            >
              <div className="text-center text-xs font-bold tracking-widest text-gray-500">
                LIVE ROUND RESULT
              </div>
              <div
                className="mt-2 text-center text-2xl font-bold tracking-widest"
                style={{ color: accent }}
              >
                {isWin ? '🎉 YOU WIN!' : isEven ? 'BREAK EVEN' : '💔 YOU LOST'}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                {m.dice.map((s, i) => (
                  <img
                    key={i}
                    src={`/symbols/${s.toLowerCase()}.jpg`}
                    alt={s}
                    className="h-12 w-12 rounded object-contain"
                    style={{ border: '1px solid #c4b5fd', background: '#f5f5f5' }}
                  />
                ))}
                <span className="ml-2 rounded-full px-3 py-1 text-xs font-bold tracking-widest" style={{ background: '#f3f4f6', color: '#1e0040' }}>
                  SUM {m.diceSum}
                </span>
              </div>
              <div
                className="mt-4 text-center text-4xl font-bold"
                style={{ color: accent }}
              >
                {amountText}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px] font-bold text-gray-600">
                <div className="rounded-md px-2 py-2" style={{ background: '#f3f4f6' }}>
                  <div className="tracking-widest">STAKE</div>
                  <div className="mt-0.5 text-sm" style={{ color: '#1e0040' }}>{m.stake.toLocaleString()}</div>
                </div>
                <div className="rounded-md px-2 py-2" style={{ background: '#f3f4f6' }}>
                  <div className="tracking-widest">PAYOUT</div>
                  <div className="mt-0.5 text-sm" style={{ color: '#1e0040' }}>{m.payout.toLocaleString()}</div>
                </div>
              </div>
              {m.bets.length > 0 && (
                <div className="mt-3 rounded-md px-3 py-2" style={{ background: '#f3f4f6' }}>
                  <div className="mb-1.5 text-[10px] font-bold tracking-widest text-gray-500">YOUR BETS THIS ROUND</div>
                  <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                    {m.bets.map((b, i) => {
                      const isWin = b.result === 'WIN'
                      const sign = isWin ? '+' : '-'
                      const amount = isWin ? b.payout - b.amount : b.amount
                      return (
                        <li
                          key={i}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded px-2 py-1 text-[11px]"
                          style={{ background: '#fff' }}
                        >
                          <span className="truncate text-gray-700">{describeSettledBet(b)}</span>
                          <span className="text-[10px] font-bold tracking-widest" style={{ color: isWin ? '#16a34a' : '#dc2626' }}>
                            {b.result}
                          </span>
                          <span className="text-right font-bold" style={{ color: isWin ? '#16a34a' : '#dc2626' }}>
                            {sign}{amount.toLocaleString()}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              <div className='w-full border-1 border-primary mt-4'></div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs font-bold tracking-widest">TOTAL BALANCE</span>
                <span className="text-xl font-bold">{m.newBalance.toLocaleString()}</span>
              </div>
              <button
                onClick={() => setLiveSettleModal(null)}
                className="mt-5 w-full rounded-xl py-3 text-sm font-bold tracking-widest transition-opacity hover:opacity-90 border"
                autoFocus
              >
                CONTINUE
              </button>
            </div>
          </div>
        )
      })()}

      {/* Sign-in overlay — opened from the Anonymous pill or when anonymous users try to switch to REAL */}
      <LoginModal
        open={loginOpen}
        hint={loginHint}
        onClose={() => setLoginOpen(false)}
        onSwitchToRegister={() => {
          setLoginOpen(false)
          setRegisterOpen(true)
        }}
      />
      <RegisterModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSwitchToLogin={() => {
          setRegisterOpen(false)
          setLoginOpen(true)
        }}
      />
    </div>
  )
}

// ─── Awaiting-result UI helpers (LIVE mode) ─────────────────────────────────

const SYMBOL_VALUE_BY_KEY: Record<SymbolKey, number> = {
  prawn: 1, crab: 2, fish: 3, rooster: 4, frog: 5, gourd: 6,
}

const RANGE_LABELS: Record<string, { label: string; range: string }> = {
  LOW: { label: 'LOW', range: '3-8' },
  MIDDLE: { label: 'MIDDLE', range: '9-10' },
  HIGH: { label: 'HIGH', range: '11-18' },
}

function DiceReveal({ dice }: { dice: (SymbolKey | null)[] }) {
  return (
    <div className="flex items-center gap-3">
      {dice.map((sym, i) => (
        <div
          key={i}
          className="relative flex items-center justify-center overflow-hidden rounded-xl bg-white shadow-xl"
          style={{ width: 64, height: 64, border: `1px solid ${sym ? '#f59e0b' : '#7c3aed'}` }}
        >
          {sym ? (
            <img src={`/symbols/${sym}.jpg`} alt={sym} className="absolute inset-0 h-full w-full object-contain p-1" />
          ) : (
            <span style={{ color: '#7c3aed', fontSize: 26 }}>?</span>
          )}
        </div>
      ))}
    </div>
  )
}

// Shared bet-description formatter used by both MyBetsList (awaiting result)
// and the settlement modal (after settlement). Shows symbol+value for SYMBOL,
// the two symbols for PAIR, and the range label+range for RANGE.
function describeBetGeneric(b: { kind: string; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null }): string {
  if (b.kind === 'SYMBOL' && b.symbol) {
    const k = b.symbol.toLowerCase() as SymbolKey
    return `${b.symbol} (${SYMBOL_VALUE_BY_KEY[k]})`
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    const a = b.pairA.toLowerCase() as SymbolKey
    const c = b.pairB.toLowerCase() as SymbolKey
    return `${b.pairA} (${SYMBOL_VALUE_BY_KEY[a]}) + ${b.pairB} (${SYMBOL_VALUE_BY_KEY[c]})`
  }
  if (b.kind === 'RANGE' && b.range) {
    const cfg = RANGE_LABELS[b.range]
    return cfg ? `${cfg.label} (${cfg.range})` : b.range
  }
  return b.kind
}

function describeSettledBet(b: { kind: string; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; amount: number }): string {
  return `${describeBetGeneric(b)} · ${b.amount.toLocaleString()}`
}

function MyBetsList({ bets }: { bets: MyLiveBet[] }) {
  const total = bets.reduce((s, b) => s + b.amount, 0)
  const describe = describeBetGeneric
  return (
    <div
      className="w-full max-w-sm rounded-xl p-4"
      style={{ background: '#1e0040', border: '1px solid #4c1d95' }}
    >
      <div className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>
        YOUR BETS THIS ROUND
      </div>
      <ul className="flex flex-col gap-1">
        {bets.map(b => (
          <li
            key={b.id}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
            style={{ background: '#2d1b4e', color: '#e9d5ff' }}
          >
            <span className="truncate">{describe(b)}</span>
            <span className="ml-2 shrink-0 font-bold" style={{ color: '#fde68a' }}>
              {b.amount.toLocaleString()} ₭
            </span>
          </li>
        ))}
      </ul>
      <div
        className="mt-2 flex items-center justify-between border-t pt-2 text-xs font-bold"
        style={{ borderColor: '#4c1d95', color: '#fde68a' }}
      >
        <span>TOTAL</span>
        <span>{total.toLocaleString()} ₭</span>
      </div>
    </div>
  )
}
