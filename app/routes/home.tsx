import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import confetti from 'canvas-confetti'
import { Form, Link, useFetcher, useLoaderData, useOutletContext, useRevalidator, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { Route } from './+types/home'
import { LoginModal } from '~/components/LoginModal'
import { JoinGroupModal } from '~/components/JoinGroupModal'
import { RegisterModal } from '~/components/RegisterModal'
import { FeatureTour, type TourStep } from '~/components/FeatureTour'
import { useUser } from '~/hooks/use-user'
import type { SessionUser, SessionWallets } from '~/root'
import { useT } from '~/lib/use-t'
import { LanguageSwitch } from '~/components/LanguageSwitch'
import { setBalance as storeSetBalance, setWalletBalance as storeSetWalletBalance, recordPlay, switchWallet, resetDemoBalance, hydrateBalances, DEMO_RESET_AMOUNT } from '~/lib/user-store'
import { useSoundEngine, playClick, playChipPlace, playCoin, startBgMusic, stopBgMusic, attachBgMusicVisibilityGuard } from '~/hooks/use-sound-engine'
import { usePresenceMembers, usePusherEvent } from '~/hooks/use-pusher'
import {
  COMPETITION_CHANNEL,
  GAME_CHANNEL,
  PRESENCE_LIVE,
  userChannel,
  type CompetitionEndedPayload,
  type CompetitionResetPayload,
  type CompetitionSummarizedPayload,
  type CompetitionToggledPayload,
  type LiveEndedPayload,
  type LiveScheduledPayload,
  type RewardCreditedPayload,
  type RoundDicePayload,
  type RoundResolvedPayload,
  type RoundSettledPayload,
  type RoundStartedPayload,
  type TxUpdatedPayload,
} from '~/lib/pusher-channels'
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, CalendarClock, Check, ChevronDown, Eye, LogOut, MessageCircle, ReceiptText, RefreshCw, Undo, User, Users, Volume2, VolumeOff, Wallet, X } from 'lucide-react'

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
  'prawn', 'fish', 'crab', 'prawn',
]

// Symbol-to-value map for dice sum (low/middle/high bets)
const SYMBOL_VALUES: Record<SymbolKey, number> = {
  prawn: 1, fish: 2, crab: 3, rooster: 4, frog: 5, gourd: 6,
}

type RangeKey = 'low' | 'middle' | 'high'

interface RangeBet {
  range: RangeKey
  amount: number
}

// Range visuals + bounds (the multiplier is intentionally NOT here — it lives
// in the server-side payout config, passed through the loader, so admins can
// tune payouts via env vars without redeploying).
const RANGE_CONFIG: ReadonlyArray<{
  key: RangeKey; label: string; range: string;
  min: number; max: number;
  bg: string; border: string; color: string;
}> = [
    {
      key: 'low', label: 'LOW', range: '1-8', min: 3, max: 8,
      bg: 'linear-gradient(135deg, #0369a1, #0c4a6e)', border: '#38bdf8', color: '#bae6fd'
    },
    {
      key: 'middle', label: 'MIDDLE', range: '9-10', min: 9, max: 10,
      bg: 'linear-gradient(135deg, #a21caf, #581c87)', border: '#e879f9', color: '#fae8ff'
    },
    {
      key: 'high', label: 'HIGH', range: '11-18', min: 11, max: 18,
      bg: 'linear-gradient(135deg, #b91c1c, #7f1d1d)', border: '#fb7185', color: '#ffe4e6'
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

// Per-range payout lookup against the server-supplied PayoutConfig.
function rangeMultiplier(key: RangeKey, cfg: { rangeLow: number; rangeMiddle: number; rangeHigh: number }): number {
  return key === 'low' ? cfg.rangeLow : key === 'middle' ? cfg.rangeMiddle : cfg.rangeHigh
}

// Embed-URL helper used by the LIVE iframe — supports YouTube watch/embed
// links, Facebook video/live links, and direct MP4 / HLS file URLs (admin can
// paste any of these). Facebook URLs are rewritten to the plugin endpoint
// because facebook.com itself sends X-Frame-Options that forbid direct iframe
// embedding ("refused to connect").
// Facebook Live is filmed on a phone → portrait (9:16). All other sources
// (YouTube, direct video, generic iframe) stay landscape (16:9).
const IS_FB_RE = /(?:facebook\.com|fb\.watch)/i
const IS_CF_RE = /cloudflarestream\.com/i

// Build the Cloudflare Stream iframe src — works from both the /iframe URL
// and the /manifest/video.m3u8 URL the admin might paste.
function cfIframeSrc(rawUrl: string, controls: boolean, muted: boolean = true): string {
  const m = rawUrl.match(/(https:\/\/customer-[^.]+\.cloudflarestream\.com\/[a-f0-9]+)/i)
  if (!m) return rawUrl
  const mutedParam = muted ? 'muted=true' : 'muted=false'
  const controlsParam = controls ? '' : '&controls=false'
  return `${m[1]}/iframe?autoplay=true&${mutedParam}&playsinline=true${controlsParam}`
}

// FB JS SDK is loaded lazily the first time a Facebook stream is embedded.
// We use the SDK (not a raw plugin iframe) for one specific reason: the SDK
// returns a `player` object whose `play()` method, called synchronously
// inside a click handler, is treated by mobile browsers as user-initiated
// media playback — which is the only way to start a live FB stream on iOS
// Safari without redirecting the user out of our site.
type FbPlayer = { play: () => void; pause: () => void; mute: () => void; unmute: () => void }
type FbReadyMsg = { type: string; instance?: FbPlayer; target?: HTMLElement }
declare global {
  interface Window {
    FB?: {
      init: (opts: { xfbml?: boolean; version: string }) => void
      XFBML: { parse: (el?: HTMLElement) => void }
      Event: {
        subscribe: (event: string, cb: (msg: FbReadyMsg) => void) => void
        unsubscribe: (event: string, cb: (msg: FbReadyMsg) => void) => void
      }
    }
  }
}
let fbSdkPromise: Promise<void> | null = null
function loadFbSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.FB) return Promise.resolve()
  if (fbSdkPromise) return fbSdkPromise
  fbSdkPromise = new Promise<void>((resolve, reject) => {
    if (!document.getElementById('fb-root')) {
      const root = document.createElement('div')
      root.id = 'fb-root'
      document.body.appendChild(root)
    }
    const script = document.createElement('script')
    script.id = 'fb-sdk-script'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      window.FB?.init({ xfbml: false, version: 'v19.0' })
      resolve()
    }
    script.onerror = () => {
      fbSdkPromise = null
      reject(new Error('fb sdk load failed'))
    }
    document.body.appendChild(script)
  })
  return fbSdkPromise
}

// HLS-aware video element. Uses HLS.js in Chrome/Firefox/Edge and native
// HLS in Safari. The hlsRef holds the instance across async resolution so
// cleanup always destroys it even if the effect fires before the import settles.
function HlsVideo({
  src,
  className,
  muted = true,
  onWaiting,
  onStalled,
  onPlaying,
  onTimeUpdate,
  onError,
}: {
  src: string
  className?: string
  muted?: boolean
  onWaiting?: () => void
  onStalled?: () => void
  onPlaying?: () => void
  onTimeUpdate?: () => void
  onError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<{ destroy(): void } | null>(null)
  const isHls = /\.m3u8(\?|$)/i.test(src)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Tear down any previous HLS instance before setting up a new one
    hlsRef.current?.destroy()
    hlsRef.current = null

    if (!isHls) {
      video.src = src
      return
    }

    // Safari: native HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.play().catch(() => { })
      return
    }

    // Chrome / Firefox / Edge: HLS.js via MSE
    import('hls.js').then(({ default: Hls }) => {
      if (!videoRef.current) return
      if (!Hls.isSupported()) {
        videoRef.current.src = src
        return
      }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(videoRef.current)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => { })
      })
    })

    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [src, isHls])

  return (
    <video
      ref={videoRef}
      className={className}
      autoPlay
      muted={muted}
      playsInline
      style={{ pointerEvents: 'none' }}
      onWaiting={onWaiting}
      onStalled={onStalled}
      onPlaying={onPlaying}
      onTimeUpdate={onTimeUpdate}
      onError={onError}
    />
  )
}

// How long (ms) a <video> can be stalled before we auto-reload it.
const VIDEO_STALL_TIMEOUT = 10_000

function LiveStreamBox({
  rawUrl,
  waitingText,
  expanded = false,
  fullScreen = false,
  bgColor = 'black',
  autoStart = false,
  children,
}: {
  rawUrl: string | null
  waitingText: string
  expanded?: boolean
  fullScreen?: boolean
  bgColor?: string
  autoStart?: boolean
  children?: ReactNode
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const fbMountRef = useRef<HTMLDivElement>(null)
  const fbPlayerRef = useRef<FbPlayer | null>(null)
  const [fbWidth, setFbWidth] = useState<number | null>(null)
  const [hasPlayed, setHasPlayed] = useState(autoStart)
  const [iframeKey, setIframeKey] = useState(0)
  const [isBuffering, setIsBuffering] = useState(false)
  // Browsers require muted autoplay on mobile. Customers tap the speaker
  // button to unmute, which counts as a user gesture.
  const [isMuted, setIsMuted] = useState(true)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCf = rawUrl ? IS_CF_RE.test(rawUrl) : false
  const isFb = rawUrl ? IS_FB_RE.test(rawUrl) : false

  const reload = useCallback(() => {
    setIsBuffering(false)
    // Reset hasPlayed so the tap-to-play overlay re-appears — on mobile this
    // re-arms the user-gesture requirement that iOS Safari needs for playback.
    setHasPlayed(false)
    setIframeKey(k => k + 1)
    fbPlayerRef.current = null
  }, [])

  useEffect(() => {
    if (!boxRef.current) return
    const w = boxRef.current.offsetWidth
    if (w >= 220) setFbWidth(Math.min(1560, w))
  }, [rawUrl])

  // Reset overlay + iframe state on URL change so the customer instantly
  // sees the latest feed when the admin updates the stream URL.
  useEffect(() => {
    setHasPlayed(false)
    setIsBuffering(false)
    setIframeKey(k => k + 1)
    fbPlayerRef.current = null
  }, [rawUrl])

  // Clear the stall timer on unmount.
  useEffect(() => {
    return () => {
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    }
  }, [])

  // Sync mute state to the Facebook SDK player when it toggles.
  useEffect(() => {
    const p = fbPlayerRef.current
    if (!p) return
    try {
      if (isMuted) p.mute()
      else p.unmute()
    } catch { /* SDK not ready yet */ }
  }, [isMuted])

  // Load the FB SDK and parse the <div class="fb-video"> into a player.
  // Subscribe BEFORE parse so we don't miss the xfbml.ready event.
  useEffect(() => {
    if (!isFb || !rawUrl || fbWidth === null || !fbMountRef.current) return
    let cancelled = false
    let handler: ((msg: FbReadyMsg) => void) | null = null
    const init = () => {
      if (cancelled || !window.FB || !fbMountRef.current) return
      handler = (msg: FbReadyMsg) => {
        if (cancelled) return
        if (msg.type !== 'video' || !msg.instance) return
        // The xfbml.ready event is global — only capture if the rendered
        // target is inside our mount point.
        if (msg.target && fbMountRef.current?.contains(msg.target)) {
          fbPlayerRef.current = msg.instance
        } else if (!fbPlayerRef.current) {
          fbPlayerRef.current = msg.instance
        }
      }
      window.FB.Event.subscribe('xfbml.ready', handler)
      window.FB.XFBML.parse(fbMountRef.current)
    }
    if (window.FB) init()
    else loadFbSdk().then(init).catch(err => {
      console.warn('[LiveStreamBox] fb sdk', err)
    })
    return () => {
      cancelled = true
      if (handler && window.FB) window.FB.Event.unsubscribe('xfbml.ready', handler)
    }
  }, [isFb, rawUrl, fbWidth, iframeKey])

  const isVideo = rawUrl ? /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(rawUrl) : false
  const isYt = rawUrl ? /(?:youtube\.com|youtu\.be)/i.test(rawUrl) : false

  // Non-FB URL builder. FB is rendered via the SDK <div class="fb-video"> below.
  const nonFbEmbedSrc: string | null = (() => {
    if (!rawUrl || isVideo || isFb || isCf) return null
    // Matches all YouTube URL shapes: watch?v=, embed/, youtu.be/, AND the
    // newer /live/<id> form used for live broadcasts.
    const yt = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)
    if (yt) {
      // playsinline=1 → iOS Safari permits muted autoplay (without it the
      //                  video sits frozen on a poster frame).
      // controls=0 + modestbranding/rel/iv_load_policy/disablekb/fs → suppress
      //                  YouTube's branded UI; the transparent overlay below
      //                  blocks the title/share strip that YouTube would
      //                  otherwise show on hover.
      return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=${isMuted ? 1 : 0}&playsinline=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0`
    }
    return rawUrl
  })()

  // Facebook live is filmed in portrait (9:16). Use a portrait box so the
  // video fills it properly instead of letterboxing in a landscape container.
  // `expanded` (non-betting phases) gives it more vertical real-estate.
  const boxStyle: React.CSSProperties = fullScreen
    ? { position: 'absolute', inset: 0 }
    : isFb
      ? { width: '100%', height: expanded ? '75vh' : '56vh', border: '1px solid #a78bfa' }
      : { width: '100%', aspectRatio: '16/9', maxHeight: expanded ? '55vh' : '38vh', border: '1px solid #a78bfa' }

  function handleTapToPlay() {
    setHasPlayed(true)
    // Synchronous play() inside the click handler is what mobile browsers
    // honor as user-initiated playback. If the SDK player isn't ready yet
    // (slow network), bump the iframeKey to force a re-parse.
    try {
      if (fbPlayerRef.current?.play) {
        fbPlayerRef.current.play()
      } else {
        setIframeKey(k => k + 1)
      }
    } catch (err) {
      console.warn('[LiveStreamBox] fb play failed', err)
      setIframeKey(k => k + 1)
    }
  }

  // Video stall detection helpers — arm a timer on stall/waiting; disarm on
  // timeupdate/playing. After VIDEO_STALL_TIMEOUT ms of no progress the
  // video element is remounted which forces the browser to re-buffer.
  function armStallTimer() {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    setIsBuffering(true)
    stallTimerRef.current = setTimeout(() => {
      setIsBuffering(false)
      setIframeKey(k => k + 1)
    }, VIDEO_STALL_TIMEOUT)
  }
  function disarmStallTimer() {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null }
    setIsBuffering(false)
  }

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-lg"
      style={{ ...boxStyle, background: bgColor, WebkitTransform: 'translate3d(0,0,0)', transform: 'translate3d(0,0,0)' }}
    >
      {!rawUrl ? (
        <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: '#a78bfa' }}>
          {waitingText}
        </div>
      ) : isCf ? (
        // Cloudflare Stream iframe — handles HLS, autoplay, and mobile Safari
        // natively via Cloudflare's own player. No HLS.js needed.
        // key includes isMuted so the iframe re-mounts when the user unmutes.
        <iframe
          key={`${iframeKey}-${isMuted ? 'm' : 'u'}`}
          src={cfIframeSrc(rawUrl, false, isMuted)}
          className="h-full w-full"
          style={{ border: 'none', display: 'block' }}
          allow="accelerometer; gyroscope; autoplay *; encrypted-media *; fullscreen *; picture-in-picture *"
          allowFullScreen
          title="Live stream"
        />
      ) : isVideo ? (
        <HlsVideo
          key={`${iframeKey}-${isMuted ? 'm' : 'u'}`}
          src={rawUrl}
          muted={isMuted}
          className="h-full w-full"
          onWaiting={armStallTimer}
          onStalled={armStallTimer}
          onPlaying={disarmStallTimer}
          onTimeUpdate={disarmStallTimer}
          onError={armStallTimer}
        />
      ) : isFb ? (
        <>
          <div ref={fbMountRef} key={iframeKey} className="h-full w-full">
            {fbWidth !== null && (
              <div
                className="fb-video"
                data-href={rawUrl}
                data-width={fbWidth}
                data-allowfullscreen="true"
                data-autoplay="true"
                data-show-text="false"
                data-show-captions="false"
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
          {!hasPlayed && (
            <button
              type="button"
              onClick={handleTapToPlay}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              style={{ background: 'rgba(0,0,0,0.55)' }}
              aria-label="Start live stream"
            >
              <span
                className="flex h-20 w-20 items-center justify-center rounded-full text-4xl shadow-2xl"
                style={{ background: 'rgba(253,230,138,0.95)', color: '#4c1d95', paddingLeft: 6 }}
              >
                ▶
              </span>
              <span className="text-sm font-bold" style={{ color: '#fde68a' }}>
                Tap to play live
              </span>
              {/* Fallback: open directly in Facebook if embed doesn't work */}
              <a
                href={rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="mt-1 text-xs underline"
                style={{ color: '#c4b5fd' }}
              >
                Can't play? Open in Facebook
              </a>
            </button>
          )}
        </>
      ) : nonFbEmbedSrc ? (
        <iframe
          key={iframeKey}
          src={nonFbEmbedSrc}
          className="h-full w-full"
          allow="autoplay *; encrypted-media *; fullscreen *; picture-in-picture *"
          allowFullScreen
          title="Live stream"
          style={{
            display: 'block',
            border: 'none',
            // YouTube → completely non-interactive: no pause, no play, no
            // hover UI, no fullscreen — the customer just watches. Autoplay
            // is driven by the URL params (autoplay/mute/playsinline), not
            // by user interaction, so disabling pointer events doesn't
            // prevent playback.
            pointerEvents: isYt ? 'none' : 'auto',
          }}
        />
      ) : null}

      {/* Buffering spinner — shown when <video> stalls while waiting to auto-reload */}
      {isBuffering && rawUrl && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <RefreshCw size={28} className="animate-spin" style={{ color: '#fde68a' }} />
          <span className="text-xs font-semibold" style={{ color: '#fde68a' }}>Buffering…</span>
        </div>
      )}

      {/* Manual reload button — always shown when a URL is set so the user
          can recover from a frozen stream without reloading the whole page.
          On the mobile full-screen view it sits in the top area (under the
          status badge); on the desktop panel it stays at the bottom. */}
      {rawUrl && (
        <button
          type="button"
          onClick={reload}
          className="absolute right-3 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-transform active:scale-95"
          style={{
            ...(fullScreen ? { top: 142 } : { bottom: 'max(env(safe-area-inset-bottom), 14px)' }),
            background: '#7c3aed',
            color: '#fff',
            boxShadow: '0 3px 16px rgba(0,0,0,0.7)',
          }}
          title={t('live.reload')}
        >
          <RefreshCw size={14} />
          {t('live.reload')}
        </button>
      )}

      {/* Sound toggle — start muted (required for autoplay), tap to unmute.
          On the mobile full-screen view it stacks UNDER the Reload button. */}
      {rawUrl && (
        <button
          type="button"
          onClick={() => setIsMuted(m => !m)}
          className="absolute z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-transform active:scale-95"
          style={{
            ...(fullScreen ? { top: 100, right: 12 } : { bottom: 'max(env(safe-area-inset-bottom), 14px)', left: 12 }),
            background: isMuted ? '#ef4444' : '#111827',
            color: '#fff',
            boxShadow: '0 3px 16px rgba(0,0,0,0.7)',
          }}
          title={isMuted ? t('live.tapForSound') : t('live.mute')}
        >
          {isMuted ? <VolumeOff size={14} /> : <Volume2 size={14} />}
          {isMuted ? t('live.tapForSound') : t('live.mute')}
        </button>
      )}

      {children}
    </div>
  )
}


// Schedule/countdown card shown to customers when there's no active live stream.
function LiveScheduleCard({
  schedule,
  compact = false,
}: {
  schedule: { start: string | null; end: string | null; notice: string | null }
  compact?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  }
  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }

  if (!schedule.start) {
    return (
      <div className="flex flex-col items-center gap-2 text-center px-4">
        <span style={{ fontSize: compact ? 32 : 48 }}>📺</span>
        <p className="text-xs font-semibold" style={{ color: '#a78bfa' }}>ບໍ່ມີການຖ່າຍທອດສົດຕອນນີ້</p>
        <p className="text-[10px]" style={{ color: '#6d28d9' }}>No live stream scheduled</p>
      </div>
    )
  }

  const startMs = new Date(schedule.start).getTime()
  const endMs = schedule.end ? new Date(schedule.end).getTime() : null
  const diffMs = startMs - now

  // Past the end time — show "stream ended" message
  if (endMs !== null && now > endMs) {
    return (
      <div className="flex flex-col items-center gap-2 text-center px-4">
        <span style={{ fontSize: compact ? 32 : 48 }}>📺</span>
        <p className="text-xs font-semibold" style={{ color: '#a78bfa' }}>ການຖ່າຍທອດສົດສິ້ນສຸດແລ້ວ</p>
      </div>
    )
  }

  // In the broadcast window — we're live but stream not available (between rounds)
  if (diffMs <= 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center px-4">
        <span className="animate-pulse" style={{ fontSize: compact ? 28 : 40 }}>🔴</span>
        <p className="text-xs font-bold" style={{ color: '#f87171' }}>ການຖ່າຍທອດສົດຈວນຈະເລີ່ມ</p>
        <p className="text-[10px]" style={{ color: '#a78bfa' }}>
          {fmtTime(schedule.start)}{schedule.end ? ` – ${fmtTime(schedule.end)}` : ''} (GMT+7)
        </p>
        {schedule.notice && (
          <p className="text-base font-semibold italic" style={{ color: '#fde68a' }}>{schedule.notice}</p>
        )}
      </div>
    )
  }

  // Countdown to start
  const totalSec = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  const units = [
    { label: 'ມື້', value: days },
    { label: 'ຊົ່ວໂມງ', value: hours },
    { label: 'ນາທີ', value: mins },
    { label: 'ວິນາທີ', value: secs },
  ]

  return (
    <div className="flex flex-col items-center gap-3 text-center px-4">
      <CalendarClock size={compact ? 28 : 40} style={{ color: '#a78bfa' }} />
      <div>
        <p className="text-base font-bold" style={{ color: '#fde68a' }}>ການຖ່າຍທອດສົດຄັ້ງຕໍ່ໄປ</p>
        <p className="mt-0.5 text-[10px]" style={{ color: '#a78bfa' }}>
          {fmtDate(schedule.start)} · {fmtTime(schedule.start)}{schedule.end ? ` – ${fmtTime(schedule.end)}` : ''} <span style={{ color: '#6d28d9' }}>(GMT+7)</span>
        </p>
      </div>
      <div className={`grid grid-cols-4 ${compact ? 'gap-1.5' : 'gap-3'}`}>
        {units.map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center">
            <span
              className="rounded-lg px-2 py-1 font-bold"
              style={{
                background: 'rgba(76,29,149,0.5)',
                color: '#fde68a',
                fontSize: compact ? '1rem' : '1.5rem',
                minWidth: compact ? 32 : 48,
              }}
            >
              {String(value).padStart(2, '0')}
            </span>
            <span className="mt-0.5" style={{ color: '#818cf8', fontSize: '0.55rem' }}>{label}</span>
          </div>
        ))}
      </div>
      {schedule.notice && (
        <p className="text-base font-semibold italic" style={{ color: '#fde68a' }}>{schedule.notice}</p>
      )}
    </div>
  )
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

// Fallback English symbol names used only for non-translated contexts (e.g. alt text).
const SYMBOL_NAMES: Record<SymbolKey, string> = {
  fish: 'Fish', prawn: 'Prawn', crab: 'Crab',
  rooster: 'Rooster', gourd: 'Gourd', frog: 'Frog',
}

// Locale-aware symbol name helper. Use this wherever the name is visible to the user.
function symName(sym: string, t: ReturnType<typeof useT>): string {
  const key = `symbol.${sym.toLowerCase()}` as Parameters<typeof t>[0]
  try { return t(key) } catch { return sym }
}

const MAX_BET_SYMBOL = 1_000_000  // Max total bet per symbol cell (×2 payout → 2,000,000)
const MAX_BET_PAIR = 200_000    // Max total bet per pair combo (×6 payout → 1,200,000)
const MAX_BET_MIDDLE = 200_000    // Max total bet on MIDDLE range (×6 payout → 1,200,000)
const MAX_BET_RANGE = 1_000_000  // Max total bet on LOW / HIGH range (×2 payout → 2,000,000)
const MAX_BET_SUM = 200_000    // Max total bet per number 3-18 (×4 payout → 800,000)

// LIVE mode only: per betting target (symbol / range / pair / number) one user may
// stake at most this much. All users combined are capped per target on the server
// (see api.play-round.tsx) — once a target reaches that round cap it's full for
// everyone. Self-play (RANDOM) keeps the larger per-target caps above.
const MAX_BET_LIVE_PER_USER = 200_000

const TOUR_STORAGE_KEY = 'fpc_tour_completed_v1'

// First-run feature discovery tour. Runs in self-play mode so every target
// (board cells, LOW/MIDDLE/HIGH range buttons) is reliably in the DOM —
// FeatureTour itself picks the first *visible* match per selector, so the
// same data-tour value can point at both the mobile and desktop variant of
// chip-selector / bet-confirm without extra branching here.
const TOUR_STEPS: TourStep[] = [
  { id: 'mode', selector: '[data-tour="mode-switcher"]', titleKey: 'tour.step1Title', bodyKey: 'tour.step1Body' },
  { id: 'account', selector: '[data-tour="account-switcher"]', titleKey: 'tour.step2Title', bodyKey: 'tour.step2Body' },
  { id: 'board', selector: '[data-tour="bet-board"]', titleKey: 'tour.step3Title', bodyKey: 'tour.step3Body' },
  { id: 'range', selector: '[data-tour="range-bets"]', titleKey: 'tour.step4Title', bodyKey: 'tour.step4Body' },
  { id: 'chips', selector: '[data-tour="chip-selector"]', titleKey: 'tour.step5Title', bodyKey: 'tour.step5Body' },
  { id: 'confirm', selector: '[data-tour="bet-confirm"]', titleKey: 'tour.step6Title', bodyKey: 'tour.step6Body' },
]

const CHIP_CONFIG = [
  { value: 5000, label: '5,000', colors: 'from-gray-600 to-gray-800', border: '#9CA3AF' },
  { value: 10000, label: '10,000', colors: 'from-blue-500 to-blue-700', border: '#60A5FA' },
  { value: 20000, label: '20,000', colors: 'from-blue-500 to-blue-700', border: '#60A5FA' },
  { value: 50000, label: '50,000', colors: 'from-green-500 to-green-700', border: '#4ADE80' },
  { value: 100000, label: '100,000', colors: 'from-yellow-500 to-yellow-700', border: '#FCD34D' },
  { value: 200000, label: '200,000', colors: 'from-red-500 to-red-700', border: '#F87171' },
]

function CountUpNumber({ from, to, duration = 1400, sound = false }: { from: number; to: number; duration?: number; sound?: boolean }) {
  const [current, setCurrent] = useState(from)
  useEffect(() => {
    if (from === to) { setCurrent(to); return }
    const start = performance.now()
    const diff = to - from
    // Play coin ticks at ~120ms intervals while counting (not every frame).
    let lastTick = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setCurrent(Math.round(from + diff * eased))
      if (sound && now - lastTick > 120) { playCoin(); lastTick = now }
      if (p < 1) requestAnimationFrame(tick)
    }
    const id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [from, to, duration, sound])
  return <>{current.toLocaleString()}</>
}

function ProcessingRing({ countdown, size }: { countdown: number; size: 'sm' | 'lg' }) {
  const dim = size === 'sm' ? 64 : 80
  const cx = dim / 2
  const r = size === 'sm' ? 26 : 32
  const circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: dim, height: dim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ position: 'absolute' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(250,204,21,0.15)" strokeWidth={size === 'sm' ? 3 : 4} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#facc15"
          strokeWidth={size === 'sm' ? 3 : 4} strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - countdown / 8)}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: countdown === 8 ? 'none' : 'stroke-dashoffset 0.9s linear' }} />
      </svg>
      <span style={{ color: '#facc15', fontWeight: 900, fontSize: size === 'sm' ? 18 : 24, position: 'relative' }}>
        {countdown}
      </span>
    </div>
  )
}

function BetCountdownRing({ countdown, size }: { countdown: number; size: 'sm' | 'lg' }) {
  const dim = size === 'sm' ? 64 : 80
  const cx = dim / 2
  const r = size === 'sm' ? 26 : 32
  const circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: dim, height: dim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ position: 'absolute' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(250,204,21,0.2)" strokeWidth={size === 'sm' ? 3 : 4} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#facc15"
          strokeWidth={size === 'sm' ? 3 : 4} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - countdown / 15)}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: 'stroke-dashoffset 0.9s linear' }} />
      </svg>
      <span style={{ color: '#fde68a', fontWeight: 900, fontSize: size === 'sm' ? 18 : 24, position: 'relative' }}>
        {countdown}
      </span>
    </div>
  )
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M`
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(2))}K`
  return n.toString()
}


interface ProfileDropdownProps {
  name: string
  onClose: () => void
  competitionEnabled?: boolean
  competitionType?: string
  onJoinGroup: () => void
}

function ProfileDropdown({ name, onClose, competitionEnabled, competitionType, onJoinGroup }: ProfileDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const items: { label: string; icon: ReactNode; href?: string; desc: string; external?: boolean; highlight?: boolean; onClick?: () => void }[] = [
    ...(competitionEnabled ? [{ label: competitionType === 'DEMO_LIVE' ? '🏆 ການແຂ່ງຂັນ Demo' : '🏆 ການແຂ່ງຂັນ Real', icon: <span style={{ fontSize: 18 }}>🏆</span>, href: '/competition', desc: competitionType === 'DEMO_LIVE' ? 'ຄະແນນ Demo Competition' : 'ຄະແນນ Real Competition', highlight: true }] : []),
    { label: t('menu.wallet'), icon: <Wallet size={18} />, href: '/wallet', desc: t('menu.walletDesc') },
    { label: t('menu.playHistory'), icon: <ReceiptText size={18} />, href: '/history', desc: t('menu.playHistoryDesc') },
    { label: t('menu.profile'), icon: <User size={18} />, href: '/profile', desc: t('menu.profileDesc') },
    { label: t('menu.rules'), icon: <BookOpen size={18} />, href: '/rules', desc: t('menu.rulesDesc') },
    { label: t('menu.contactAdmin'), icon: <MessageCircle size={18} />, href: 'https://wa.me/8562076350786', desc: t('menu.contactAdminDesc'), external: true },
    // Join Group menu — temporarily disabled (re-enable later by uncommenting):
    // { label: t('menu.joinGroup'), icon: <Users size={18} />, desc: t('menu.joinGroupDesc'), onClick: onJoinGroup },
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
        {items.map(item =>
          item.onClick ? (
            <button
              key={item.label}
              onClick={() => {
                playClick()
                onClose()
                item.onClick!()
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-all hover:opacity-90"
              style={{ background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#2d1b4e')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: '#fff' }}>{item.icon}</span>
              <div>
                <div className="text-sm font-semibold" style={{ color: '#e9d5ff' }}>{item.label}</div>
                <div className="text-[10px] text-white">{item.desc}</div>
              </div>
            </button>
          ) : item.external ? (
            <button
              key={item.href}
              onClick={() => {
                playClick()
                onClose()
                window.open(item.href, '_blank', 'noopener,noreferrer')
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-all hover:opacity-90"
              style={{ background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#2d1b4e')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: '#fff' }}>{item.icon}</span>
              <div>
                <div className="text-sm font-semibold" style={{ color: '#e9d5ff' }}>{item.label}</div>
                <div className="text-[10px] text-white">{item.desc}</div>
              </div>
            </button>
          ) : (
            <Link
              key={item.href}
              to={item.href!}
              prefetch="intent"
              onClick={() => { playClick(); onClose() }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-all hover:opacity-90"
              style={{ background: item.highlight ? 'rgba(202,138,4,0.12)' : 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = item.highlight ? 'rgba(202,138,4,0.2)' : '#2d1b4e')}
              onMouseLeave={e => (e.currentTarget.style.background = item.highlight ? 'rgba(202,138,4,0.12)' : 'transparent')}
            >
              <span style={{ color: item.highlight ? '#fbbf24' : '#fff' }}>{item.icon}</span>
              <div>
                <div className="text-sm font-semibold" style={{ color: item.highlight ? '#fbbf24' : '#e9d5ff' }}>{item.label}</div>
                <div className="text-[10px] text-white">{item.desc}</div>
              </div>
            </Link>
          )
        )}
      </div>

      <div className="mx-4" style={{ height: 1, background: '#4c1d95' }} />

      <div className="px-4 py-3">
        <div className="mb-2 text-[10px] font-bold " style={{ color: '#a78bfa' }}>
          {t('menu.language')}
        </div>
        <LanguageSwitch variant="inline" />
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

// Small generic single-section picker. Reused by both the mode toggle (left
// header slot) and the wallet selector (right header slot).
interface PickerDropdownProps {
  items: { key: string; label: string }[]
  active: string
  onSelect: (key: string) => void
  onClose: () => void
  align?: 'left' | 'right'
}

function PickerDropdown({ items, active, onSelect, onClose, align = 'left' }: PickerDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 mt-1 rounded-md overflow-hidden shadow-2xl`}
      style={{
        minWidth: 160,
        background: '#1e0040',
        border: '1px solid #a78bfa',
        boxShadow: '0 8px 40px rgba(124,58,237,0.5)',
      }}
    >
      <div className="py-1">
        {items.map(item => {
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              onClick={() => { playClick(); onSelect(item.key); onClose() }}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-all"
              style={{ background: isActive ? '#2d1b4e' : 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#2d1b4e')}
              onMouseLeave={e => (e.currentTarget.style.background = isActive ? '#2d1b4e' : 'transparent')}
            >
              <span className="text-sm font-semibold" style={{ color: isActive ? '#fde68a' : '#e9d5ff' }}>{item.label}</span>
              {isActive && <Check size={14} style={{ color: '#fde68a' }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Shape of a single bet in the customer's "your bets in this round" list.
type MyLiveBet = {
  id: string
  kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'
  amount: number
  symbol: string | null
  range: string | null
  pairA: string | null
  pairB: string | null
  exactSum: number | null
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
  const { getPayoutConfig } = await import('~/lib/payouts.server')
  const payoutConfig = getPayoutConfig()

  // The currently in-flight LIVE round (if any), plus the admin-controlled
  // stream URL and next schedule from SystemSetting. The stream URL is set
  // when admin starts a round and cleared when admin clicks "End Live".
  const { getLiveStreamUrl, getLiveSchedule, getCompetitionConfig } = await import('~/lib/system-settings.server')
  const [liveRoundRaw, liveStreamUrl, schedule, competitionCfg] = await Promise.all([
    prisma.gameRound.findFirst({
      where: { mode: 'LIVE', status: { in: ['BETTING', 'LOCKED', 'AWAITING_RESULT'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, streamUrl: true, bettingClosesAt: true, dice1: true, dice2: true, dice3: true },
    }),
    getLiveStreamUrl(),
    getLiveSchedule(),
    getCompetitionConfig(),
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

  if (!user) {
    return {
      selfPlayHistory: [] as SymbolKey[][],
      liveHistory: [] as SymbolKey[][],
      liveRound, liveStreamUrl, schedule,
      competitionEnabled: competitionCfg.enabled,
      competitionMenuVisible: competitionCfg.menuVisible,
      competitionType: competitionCfg.type,
      isCompetitionParticipant: false,
      myLiveBets: [] as MyLiveBet[],
      payoutConfig,
      hasSeenTour: false,
      betLocked: false,
    }
  }

  // The customer's own bets in the current LIVE round — populates the
  // "your bets in this round" list shown during the awaiting-result phase.
  //
  // Round-level rule for ADMIN_LOCKED users: if ANY of their bets would win more
  // than 500,000 ₭ profit (return − stake), HIDE ALL of their bets from their own
  // screen for this round. The bets still exist and settle at resolve (all
  // refunded if the big bet wins; otherwise settled normally).
  const { liveBetPotentialReturn, LOCKED_LIVE_VOID_RETURN_MIN } = await import('~/lib/game-logic.server')
  const _promoSum = process.env.PROMO_SUM === 'true'
  const _myRawBets = liveRound
    ? await prisma.bet.findMany({
      where: { roundId: liveRound.id, userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, amount: true, symbol: true, range: true, pairA: true, pairB: true, exactSum: true },
    })
    : []
  const _hideAllMyBets = user.selfPlayPhase === 'ADMIN_LOCKED' && _myRawBets.some(b =>
    liveBetPotentialReturn(b, payoutConfig, { promoSum: _promoSum }) - b.amount > LOCKED_LIVE_VOID_RETURN_MIN,
  )
  const myLiveBets = _hideAllMyBets
    ? []
    : _myRawBets.map(b => ({
        id: b.id,
        kind: b.kind as 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM',
        amount: b.amount,
        symbol: b.symbol as string | null,
        range: b.range as string | null,
        pairA: b.pairA as string | null,
        pairB: b.pairB as string | null,
        exactSum: b.exactSum as number | null,
      }))

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
    liveStreamUrl,
    schedule,
    competitionEnabled: competitionCfg.enabled,
    competitionMenuVisible: competitionCfg.menuVisible,
    competitionType: competitionCfg.type,
    isCompetitionParticipant: competitionCfg.type !== 'DEMO_LIVE' && competitionCfg.enabled
      ? !!(await prisma.competitionParticipant.findUnique({ where: { userId: user.id } }))
      : false,
    myLiveBets,
    payoutConfig,
    hasSeenTour: user.hasSeenTour,
    betLocked: user.betLocked,
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
    if (serverWallets) hydrateBalances(serverWallets.demo, serverWallets.real, serverWallets.promo)
  }, [serverWallets?.demo, serverWallets?.real, serverWallets?.promo])
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
  const [currentSumBets, setCurrentSumBets] = useState<{ sum: number; amount: number }[]>([])
  const [currentPairBets, setCurrentPairBets] = useState<PairBet[]>([])
  const [pendingCell, setPendingCell] = useState<number | null>(null)
  const [selectedChip, setSelectedChip] = useState(5_000)
  const [resultModal, setResultModal] = useState<{
    win: number; betTotal: number; newBalance: number; dice: SymbolKey[]; diceSum: number
    symbolResults: { symbol: SymbolKey; amount: number; payout: number; won: boolean }[]
    rangeResults: { range: RangeKey; amount: number; payout: number; won: boolean }[]
    pairResults: { a: SymbolKey; b: SymbolKey; amount: number; payout: number; won: boolean }[]
  } | null>(null)
  const [diceResults, setDiceResults] = useState<SymbolKey[]>([])
  const [rollingDice, setRollingDice] = useState<SymbolKey[]>([])
  const [isRolling, setIsRolling] = useState(false)
  const [isWaitingReveal, setIsWaitingReveal] = useState(false)
  const [isRevealingResult, setIsRevealingResult] = useState(false)
  const [rollAnimationDone, setRollAnimationDone] = useState(false)
  const waitingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const revealCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [revealCountdown, setRevealCountdown] = useState(3)
  // isRoundOpen: true while the 15s betting window is open (board enabled).
  const [isRoundOpen, setIsRoundOpen] = useState(false)
  const [betCountdown, setBetCountdown] = useState(15)
  const [processingCountdown, setProcessingCountdown] = useState(8)
  const [processingDiceIdx, setProcessingDiceIdx] = useState(0)
  const betCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRollRef = useRef<(() => void) | null>(null)
  const hasAnyBetRef = useRef(false)
  const hasWarmed = useRef(false)
  // Pre-computed adversarial dice — filled in the background when bets change,
  // consumed at roll time so the user never waits for the pick-dice response.
  const [precomputedRound, setPrecomputedRound] = useState<{ dice: string[]; token: string; betsKey: string } | null>(null)
  const pendingDiceRef = useRef<{ dice: string[]; token: string } | null>(null)
  const precomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Yellow winner-highlight on the board (cells + range buttons) only stays
  // up for ~5s after a roll resolves — long enough for the player to clock
  // which bets won, short enough that the next set of chips doesn't sit
  // on a board still glowing from the previous round.
  const [winnerHighlight, setWinnerHighlight] = useState(false)
  const [lastWin, setLastWin] = useState(0)
  const [lastBetTotal, setLastBetTotal] = useState(0)
  const [history, setHistory] = useState<SymbolKey[][]>([])
  const [message, setMessage] = useState<string>(t('game.placeBet'))
  const [profileOpen, setProfileOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [bgStarted, setBgStarted] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  // Live (streaming) mode — driven by the admin's open round (loaderData.liveRound).
  // Initial state is 'random' for SSR consistency; the persisted choice is
  // restored from localStorage in a mount effect below so we don't break
  // hydration.
  const [mode, setMode] = useState<'random' | 'live'>('random')
  // Feature discovery tour — runs in self-play mode so every target element
  // is reliably present. modeBeforeTourRef remembers what the player was on
  // so we can switch them back once the tour ends.
  const [tourOpen, setTourOpen] = useState(false)
  const modeBeforeTourRef = useRef<'random' | 'live'>('random')
  const [betSheetOpen, setBetSheetOpen] = useState(false)
  const sheetGridRef = useRef<HTMLDivElement>(null)
  const [sheetGridSize, setSheetGridSize] = useState({ w: 0, h: 0 })
  const cancelBetFetcher = useFetcher<{ ok?: boolean; newBalance?: number; error?: string }>()
  const resetDemoFetcher = useFetcher<{ ok?: boolean; balance?: number; error?: string }>()
  const resetDemoHandled = useRef(false)
  const [cancelledBetIds, setCancelledBetIds] = useState<Set<string>>(new Set())
  const [cancelConfirmBet, setCancelConfirmBet] = useState<{ id: string; amount: number } | null>(null)
  // Separate dropdown state for the overlay header so it doesn't conflict with the main header.
  const [overlayModeOpen, setOverlayModeOpen] = useState(false)
  const [overlayWalletOpen, setOverlayWalletOpen] = useState(false)
  const [overlayProfileOpen, setOverlayProfileOpen] = useState(false)
  const [joinGroupOpen, setJoinGroupOpen] = useState(false)
  const liveRound = loaderData.liveRound
  // Bet-locked users can watch a LIVE round but never see the betting board.
  const betLocked = loaderData.betLocked
  // The URL shown to customers: active round's stream takes priority; otherwise
  // use the admin-controlled SystemSetting (cleared by "End Live").
  const activeStreamUrl = liveRound?.streamUrl ?? loaderData.liveStreamUrl ?? null

  // Tracks whether a LIVE round is currently open, kept in sync via the
  // public `game` channel (see notifyGame in admin.live.tsx) so self-play
  // players get nudged toward LIVE mode without subscribing to the
  // presence-live channel (which would inflate the viewer count). Drives
  // both the pulsing badge on the mode switcher and the dismissible banner.
  const [liveRoundActive, setLiveRoundActive] = useState(!!liveRound)
  const [activeLiveRoundId, setActiveLiveRoundId] = useState<string | null>(liveRound?.id ?? null)
  useEffect(() => {
    setLiveRoundActive(!!loaderData.liveRound)
    setActiveLiveRoundId(loaderData.liveRound?.id ?? null)
  }, [loaderData.liveRound?.id])

  usePusherEvent<RoundStartedPayload>(GAME_CHANNEL, 'round:started', payload => {
    setLiveRoundActive(true)
    setActiveLiveRoundId(payload.roundId)
  })
  usePusherEvent<LiveEndedPayload>(GAME_CHANNEL, 'live:ended', () => {
    setLiveRoundActive(false)
  })

  // One-time-per-round dismissible nudge banner — re-appears for a new round
  // even if the previous one was dismissed, since that's a fresh chance to join.
  const [liveBannerDismissed, setLiveBannerDismissed] = useState(false)
  useEffect(() => {
    if (!activeLiveRoundId) { setLiveBannerDismissed(false); return }
    try {
      setLiveBannerDismissed(sessionStorage.getItem('fpc_live_banner_dismissed') === activeLiveRoundId)
    } catch { /* sessionStorage may be unavailable */ }
  }, [activeLiveRoundId])
  function dismissLiveBanner() {
    setLiveBannerDismissed(true)
    try {
      if (activeLiveRoundId) sessionStorage.setItem('fpc_live_banner_dismissed', activeLiveRoundId)
    } catch { /* sessionStorage may be unavailable */ }
  }

  // Local competition state — updated immediately via Pusher (before loader revalidation)
  const [competitionEnabled, setCompetitionEnabledLocal] = useState(loaderData.competitionEnabled)
  const [competitionMenuVisible, setCompetitionMenuVisibleLocal] = useState(loaderData.competitionMenuVisible)
  useEffect(() => { setCompetitionEnabledLocal(loaderData.competitionEnabled) }, [loaderData.competitionEnabled])
  useEffect(() => { setCompetitionMenuVisibleLocal(loaderData.competitionMenuVisible) }, [loaderData.competitionMenuVisible])
  const revalidator = useRevalidator()

  // Restore the user's last-selected play mode from localStorage on mount.
  // The mode persists across refreshes and app restarts; only an explicit
  // selectMode() call overwrites it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fpc_play_mode')
      if (saved === 'live') {
        setMode('live')
        revalidator.revalidate() // pick up any in-flight live round
      }
    } catch { /* localStorage may be unavailable */ }
    // Intentionally mount-only — re-running this on revalidator changes would
    // re-trigger revalidation in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [rewardModal, setRewardModal] = useState<RewardCreditedPayload | null>(null)

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
  // Admin updated the stream URL mid-round → revalidate so the new feed
  // replaces the old iframe without requiring an app restart.
  usePusherEvent<{ roundId: string; streamUrl: string | null }>(
    presenceChannel,
    'round:streamUpdated',
    () => { revalidator.revalidate() },
  )

  // Admin ended the live stream (End Live button) or updated the schedule →
  // revalidate so liveStreamUrl + schedule come fresh from the server.
  usePusherEvent<LiveEndedPayload>(presenceChannel, 'live:ended', () => {
    revalidator.revalidate()
  })
  usePusherEvent<LiveScheduledPayload>(presenceChannel, 'live:scheduled', () => {
    revalidator.revalidate()
  })

  // Admin reset all demo wallets — update in-app demo balance immediately.
  usePusherEvent<CompetitionResetPayload>(COMPETITION_CHANNEL, 'competition:reset', payload => {
    storeSetWalletBalance('demo', payload.newBalance)
    if (user.activeWallet === 'demo') setBalance(payload.newBalance)
  })

  usePusherEvent<CompetitionToggledPayload>(COMPETITION_CHANNEL, 'competition:toggled', payload => {
    setCompetitionEnabledLocal(payload.enabled)
    if (payload.enabled) setCompetitionMenuVisibleLocal(true)
    revalidator.revalidate()
    if (payload.enabled && mode === 'random') {
      const cType = loaderData.competitionType
      // DEMO_LIVE: demo self-play blocked → switch to real
      if (cType === 'DEMO_LIVE' && user.activeWallet === 'demo') {
        setCurrentBets([]); setCurrentRangeBets([]); setCurrentPairBets([]); setCurrentSumBets([]); setPendingCell(null)
        switchWallet('real'); setBalance(user.balances.real)
      }
      // REAL_LIVE: real self-play blocked for participants only → switch to demo
      if (cType === 'REAL_LIVE' && user.activeWallet === 'real' && loaderData.isCompetitionParticipant) {
        setCurrentBets([]); setCurrentRangeBets([]); setCurrentPairBets([]); setCurrentSumBets([]); setPendingCell(null)
        switchWallet('demo'); setBalance(user.balances.demo)
      }
      // REAL_ALL: no auto-switch needed
    }
  })

  // Summary taken — menu stays visible
  usePusherEvent<CompetitionSummarizedPayload>(COMPETITION_CHANNEL, 'competition:summarized', () => {
    setCompetitionMenuVisibleLocal(true)
  })

  // Competition ended — hide menu immediately
  usePusherEvent<CompetitionEndedPayload>(COMPETITION_CHANNEL, 'competition:ended', () => {
    setCompetitionEnabledLocal(false)
    setCompetitionMenuVisibleLocal(false)
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

  usePusherEvent<RewardCreditedPayload>(
    authUser ? userChannel(authUser.id) : null,
    'reward:credited',
    payload => {
      setRewardModal(payload)
      confetti({ particleCount: 160, spread: 80, angle: 60, origin: { x: 0, y: 0.6 } })
      confetti({ particleCount: 160, spread: 80, angle: 120, origin: { x: 1, y: 0.6 } })
      setTimeout(() => {
        confetti({ particleCount: 80, spread: 100, angle: 90, origin: { x: 0.5, y: 0.35 }, startVelocity: 50 })
      }, 300)
      // Revalidate after a short delay so the loader re-fetches the wallet
      // balance that now includes the bonus credit.
      setTimeout(() => revalidator.revalidate(), 600)
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
      // Suppress toasts for round settlements — the result modal already shows
      // payout details comprehensively. Only show for other tx types (deposits etc).
      if (payload.id.startsWith('round:')) return
      toast.message(t('live.updateTitle'), {
        description: t('live.balance', { amount: payload.balanceAfter.toLocaleString() }),
      })
    },
  )

  const [searchParams] = useSearchParams()

  // Grid size tracking for drawing pair connector lines.
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 })

  const ensureBgMusic = useCallback(() => {
    // No background music in LIVE mode — admin talks to viewers via the stream
    // and the BG track would compete with their voice.
    if (mode === 'live') return
    if (!bgStarted && soundEnabled) {
      startBgMusic(0.1)
      setBgStarted(true)
    }
  }, [bgStarted, soundEnabled, mode])

  // Stop bg music whenever we switch to LIVE mode.
  useEffect(() => {
    if (mode === 'live' && bgStarted) {
      stopBgMusic()
      setBgStarted(false)
    }
  }, [mode, bgStarted])

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
    currentPairBets.reduce((sum, b) => sum + b.amount, 0) +
    currentSumBets.reduce((sum, b) => sum + b.amount, 0)
  const getBetAmount = (cell: number) => currentBets.find(b => b.cell === cell)?.amount ?? 0
  const getRangeBetAmount = (range: RangeKey) => currentRangeBets.find(b => b.range === range)?.amount ?? 0
  const getSumBetAmount = (sum: number) => currentSumBets.find(b => b.sum === sum)?.amount ?? 0
  // Pair amount for a specific cell (not symbol) so only the tapped cell lights up,
  // even when the same symbol appears twice on the board.
  const getPairBetAmount = (cellIdx: number) =>
    currentPairBets.filter(p => p.cellA === cellIdx || p.cellB === cellIdx).reduce((s, p) => s + p.amount, 0)
  const hasAnyBet = currentBets.length > 0 || currentRangeBets.length > 0 || currentPairBets.length > 0 || currentSumBets.length > 0
  const diceSum = diceResults.reduce((s, sym) => s + SYMBOL_VALUES[sym], 0)
  const bettingLocked = isRolling ||
    (mode === 'random' && !isRoundOpen) ||
    (mode === 'live' && livePhase !== 'betting')
  // True while the random board AND chip selectors should appear disabled.
  const randomBoardLocked = mode === 'random' && bettingLocked

  // Pause BGM when the PWA goes to background, resume on return.
  useEffect(() => { attachBgMusicVisibilityGuard() }, [])

  // Keep the serverless function warm by pinging /api/warm on mount and every
  // 60 s. Vercel keeps a function instance alive for ~5 min after last use;
  // regular pings prevent cold starts for active players.
  useEffect(() => {
    if (!authUser) return
    fetch('/api/warm').catch(() => { })
    const id = setInterval(() => fetch('/api/warm').catch(() => { }), 60_000)
    return () => clearInterval(id)
  }, [authUser])

  // Pre-compute adversarial dice in the background whenever the bet layout
  // changes so the result is ready the instant the player clicks Roll.
  // Uses a 350 ms debounce to avoid hammering the server on rapid chip taps.
  useEffect(() => {
    hasAnyBetRef.current = hasAnyBet
    if (!hasAnyBet || !authUser || mode !== 'random' || isRolling || !isRoundOpen) return

    const wallet = user.activeWallet === 'real' ? 'REAL' : user.activeWallet === 'promo' ? 'PROMO' : 'DEMO'
    const betsPayload = {
      wallet,
      bets: {
        symbol: currentBets.map(b => ({ symbol: b.symbol.toUpperCase(), cell: b.cell, amount: b.amount })),
        range: currentRangeBets.map(b => ({ range: b.range.toUpperCase(), amount: b.amount })),
        pair: currentPairBets.map(b => ({ symbolA: b.a.toUpperCase(), symbolB: b.b.toUpperCase(), cellA: b.cellA, cellB: b.cellB, amount: b.amount })),
      },
    }
    const betsKey = JSON.stringify(betsPayload)
    if (precomputedRound?.betsKey === betsKey) return // already fresh

    if (precomputeTimerRef.current) clearTimeout(precomputeTimerRef.current)
    precomputeTimerRef.current = setTimeout(() => {
      fetch('/api/pick-dice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(betsPayload),
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.dice && data.token) {
            setPrecomputedRound({ dice: data.dice, token: data.token, betsKey })
          }
        })
        .catch(() => { })
    }, 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBets, currentRangeBets, currentPairBets, hasAnyBet, authUser, mode, isRolling, isRoundOpen, user.activeWallet])

  const placeRangeBet = useCallback((range: RangeKey) => {
    ensureBgMusic()
    if (bettingLocked || balance < selectedChip) return
    if (range === 'middle') {
      const existing = currentRangeBets.find(b => b.range === 'middle')?.amount ?? 0
      if (existing + selectedChip > MAX_BET_MIDDLE) {
        toast.warning(`ວົງເດີມພັນກາງສູງສຸດ ${MAX_BET_MIDDLE.toLocaleString()} ₭`)
        return
      }
    } else {
      // LOW / HIGH: 200k per user in LIVE, larger cap in self-play.
      const cap = mode === 'live' ? MAX_BET_LIVE_PER_USER : MAX_BET_RANGE
      const existing = currentRangeBets.find(b => b.range === range)?.amount ?? 0
      if (existing + selectedChip > cap) {
        toast.warning(`ວົງເດີມພັນສູງສຸດ ${cap.toLocaleString()} ₭`)
        return
      }
    }
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
  }, [bettingLocked, balance, selectedChip, ensureBgMusic, soundEnabled, currentRangeBets, mode])

  const placeSumBet = useCallback((sum: number) => {
    ensureBgMusic()
    if (bettingLocked || balance < selectedChip) return
    const isNew = !currentSumBets.find(b => b.sum === sum)
    if (isNew && currentSumBets.length >= 3) return
    const existing = currentSumBets.find(b => b.sum === sum)?.amount ?? 0
    if (existing + selectedChip > MAX_BET_SUM) {
      toast.warning(`ວົງເດີມພັນເລກສູງສຸດ ${MAX_BET_SUM.toLocaleString()} ₭`)
      return
    }
    soundEnabled && playChipPlace()
    setCurrentSumBets(prev => {
      const idx = prev.findIndex(b => b.sum === sum)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], amount: next[idx].amount + selectedChip }
        return next
      }
      return [...prev, { sum, amount: selectedChip }]
    })
    setBalance(prev => prev - selectedChip)
  }, [bettingLocked, balance, selectedChip, currentSumBets, ensureBgMusic, soundEnabled])

  const placePairBet = useCallback((cA: number, cB: number) => {
    if (balance < selectedChip) return
    const [cellA, cellB] = cA < cB ? [cA, cB] : [cB, cA]
    const a = BOARD_LAYOUT[cellA]
    const b = BOARD_LAYOUT[cellB]
    const existing = currentPairBets.find(p => p.cellA === cellA && p.cellB === cellB)?.amount ?? 0
    if (existing + selectedChip > MAX_BET_PAIR) {
      toast.warning(`ວົງເດີມພັນຄູ່ສູງສຸດ ${MAX_BET_PAIR.toLocaleString()} ₭`)
      return
    }
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
  }, [balance, selectedChip, ensureBgMusic, soundEnabled, currentPairBets])

  const addSingleChips = useCallback((cell: number, chips: number) => {
    if (chips <= 0) return
    const total = selectedChip * chips
    const symbol = BOARD_LAYOUT[cell]
    // LIVE caps a single symbol at 200k PER SYMBOL (summed across its board cells,
    // e.g. both GOURD cells share one cap); self-play keeps the per-cell cap.
    const cap = mode === 'live' ? MAX_BET_LIVE_PER_USER : MAX_BET_SYMBOL
    const existing = mode === 'live'
      ? currentBets.filter(b => BOARD_LAYOUT[b.cell] === symbol).reduce((s, b) => s + b.amount, 0)
      : (currentBets.find(b => b.cell === cell)?.amount ?? 0)
    if (existing >= cap) {
      toast.warning(`ວົງເດີມພັນສັດດ່ຽວສູງສຸດ ${cap.toLocaleString()} ₭`)
      return
    }
    const actualAdd = Math.min(total, cap - existing)
    if (actualAdd < total) toast.warning(`ວົງເດີມພັນສັດດ່ຽວສູງສຸດ ${cap.toLocaleString()} ₭`)
    ensureBgMusic()
    soundEnabled && playChipPlace()
    setCurrentBets(prev => {
      const i = prev.findIndex(b => b.cell === cell)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], amount: next[i].amount + actualAdd }
        return next
      }
      return [...prev, { cell, symbol, amount: actualAdd }]
    })
    setBalance(prev => prev - actualAdd)
  }, [selectedChip, ensureBgMusic, soundEnabled, currentBets, mode])

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
    if (currentPairBets.length === 0 && currentRangeBets.length === 0 && currentBets.length === 0 && currentSumBets.length === 0) return
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
    } else if (currentSumBets.length > 0) {
      const last = currentSumBets[currentSumBets.length - 1]
      setCurrentSumBets(prev => {
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
  }, [pendingCell, currentBets, currentRangeBets, currentPairBets, currentSumBets, selectedChip, ensureBgMusic, soundEnabled])

  // Apply the outcome of a roll (random or live-entered). Payout + state reset.
  // Multipliers come from the server-supplied payout config so the optimistic
  // client-side win shown in the result modal matches what the server records.
  const applyResult = useCallback((finalResults: SymbolKey[]) => {
    const sum = finalResults.reduce((s, sym) => s + SYMBOL_VALUES[sym], 0)
    // Always stop the roll sound — safety net in case the 8s timeout didn't.
    stopRollSound()
    if (waitingIntervalRef.current) {
      clearInterval(waitingIntervalRef.current)
      waitingIntervalRef.current = null
    }
    setRollingDice([])
    setIsWaitingReveal(false)
    setDiceResults(finalResults)
    setHistory(prev => [finalResults, ...prev].slice(0, 30))

    // Per-bet payout calc — captured into typed result lists so the result
    // modal can render Single / Range / Pair sections + a summary alongside
    // the headline net total.
    const pc = loaderData.payoutConfig
    const symbolResults = currentBets.map(bet => {
      const matches = finalResults.filter(r => r === bet.symbol).length
      const payout = matches === 1 ? bet.amount * pc.symbol1
        : matches === 2 ? bet.amount * pc.symbol2
          : matches === 3 ? bet.amount * pc.symbol3
            : 0
      return { symbol: bet.symbol, amount: bet.amount, payout, won: payout > 0 }
    })
    const rangeResults = currentRangeBets.map(rb => {
      const cfg = RANGE_CONFIG.find(c => c.key === rb.range)!
      const won = sum >= cfg.min && sum <= cfg.max
      const payout = won ? rb.amount * rangeMultiplier(rb.range, pc) : 0
      return { range: rb.range, amount: rb.amount, payout, won }
    })
    const pairResults = currentPairBets.map(pb => {
      const won = finalResults.includes(pb.a) && finalResults.includes(pb.b)
      const payout = won ? pb.amount * pc.pair : 0
      return { a: pb.a, b: pb.b, amount: pb.amount, payout, won }
    })
    const win = [...symbolResults, ...rangeResults, ...pairResults].reduce((s, b) => s + b.payout, 0)

    const betTotal =
      currentBets.reduce((s, b) => s + b.amount, 0) +
      currentRangeBets.reduce((s, b) => s + b.amount, 0) +
      currentPairBets.reduce((s, b) => s + b.amount, 0)

    // PROMO rule: winning stakes are refunded to PROMO; only profit goes to REAL.
    // `balance` here is already post-stake-deduction (chips placed reduce the display).
    const isPromo = user.activeWallet === 'promo'
    let newBalance: number
    if (isPromo) {
      const winningStake =
        symbolResults.filter(r => r.won).reduce((s, r) => s + r.amount, 0) +
        rangeResults.filter(r => r.won).reduce((s, r) => s + r.amount, 0) +
        pairResults.filter(r => r.won).reduce((s, r) => s + r.amount, 0)
      const profit = win - winningStake
      newBalance = balance + winningStake  // refund winning stakes back to PROMO
      storeSetBalance(newBalance)
      if (profit > 0) {
        storeSetWalletBalance('real', user.balances.real + profit)
      }
    } else {
      newBalance = balance + win
      storeSetBalance(newBalance)
    }
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

    setCurrentBets([])
    setCurrentRangeBets([])
    setCurrentPairBets([])
    setCurrentSumBets([])
    setIsRolling(false)
    setIsRoundOpen(false)
    setBetCountdown(15)
    setWinnerHighlight(true)
    setPrecomputedRound(null) // force fresh dice for next round
    if (win > 0) {
      setMessage(t('game.youWin', { amount: formatAmount(win) }))
      soundEnabled && playWin()
    } else {
      setMessage(t('game.betterLuck'))
      soundEnabled && playLose()
    }

    // Show dice for 5s with a live countdown before opening the summary modal.
    if (betTotal > 0) {
      setIsRevealingResult(true)
      setRevealCountdown(3)
      if (revealCountdownRef.current) clearInterval(revealCountdownRef.current)
      revealCountdownRef.current = setInterval(() => {
        setRevealCountdown(c => Math.max(0, c - 1))
      }, 1000)

      setTimeout(() => {
        if (revealCountdownRef.current) {
          clearInterval(revealCountdownRef.current)
          revealCountdownRef.current = null
        }
        setIsRevealingResult(false)
        confetti({ particleCount: 120, spread: 70, angle: 60, origin: { x: 0, y: 0.65 } })
        confetti({ particleCount: 120, spread: 70, angle: 120, origin: { x: 1, y: 0.65 } })
        setTimeout(() => {
          confetti({ particleCount: 60, spread: 90, angle: 90, origin: { x: 0.5, y: 0.4 }, startVelocity: 45 })
        }, 300)
        setResultModal({
          win, betTotal, newBalance,
          dice: finalResults, diceSum: sum,
          symbolResults, rangeResults, pairResults,
        })
      }, 1000)
    }
  }, [currentBets, currentRangeBets, currentPairBets, balance, soundEnabled, playWin, playLose, stopRollSound])

  // ── startRoll: 8-second processing animation, fires automatically when the
  //    30s betting window closes. Dice may already be pre-computed; if not,
  //    pick-dice is called now (function is warm from the keep-alive ping).
  const startRoll = useCallback(() => {
    if (!hasAnyBetRef.current) {
      // No bets placed — just reopen for another round.
      setIsRoundOpen(false)
      setBetCountdown(15)
      return
    }
    setIsRoundOpen(false)
    setProcessingCountdown(8) // reset before mount so bar starts at 100%
    setIsRolling(true)
    setMessage(t('game.rolling'))
    soundEnabled && startRollSound()

    // Always call pick-dice fresh at roll time so the server can apply the
    // latest phase (e.g. admin lock applied between precompute and roll).
    // The 8-second animation gives pick-dice plenty of time to respond.
    if (authUser) {
      const wallet = user.activeWallet === 'real' ? 'REAL' : user.activeWallet === 'promo' ? 'PROMO' : 'DEMO'
      const betsPayload = {
        wallet,
        bets: {
          symbol: currentBets.map(b => ({ symbol: b.symbol.toUpperCase(), cell: b.cell, amount: b.amount })),
          range: currentRangeBets.map(b => ({ range: b.range.toUpperCase(), amount: b.amount })),
          pair: currentPairBets.map(b => ({ symbolA: b.a.toUpperCase(), symbolB: b.b.toUpperCase(), cellA: b.cellA, cellB: b.cellB, amount: b.amount })),
        },
      }
      pendingDiceRef.current = null
      setPrecomputedRound(null)
      playRoundFetcher.submit(betsPayload, { method: 'post', action: '/api/pick-dice', encType: 'application/json' })
    }

    const rollInterval = setInterval(() => {
      setRollingDice([
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      ])
    }, 80)

    setTimeout(() => {
      clearInterval(rollInterval)
      stopRollSound() // always stop — no soundEnabled guard so it can't leak
      if (authUser) {
        waitingIntervalRef.current = setInterval(() => {
          setRollingDice([
            SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
            SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
            SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          ])
        }, 160)
        setIsWaitingReveal(true)
        setRollAnimationDone(true)
      } else {
        setRollingDice([])
        const finalResults: SymbolKey[] = [
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        ]
        applyResult(finalResults)
      }
    }, 8000)
  }, [soundEnabled, startRollSound, stopRollSound, applyResult, authUser,
    currentBets, currentRangeBets, currentPairBets, user.activeWallet,
    playRoundFetcher, precomputedRound])

  // Keep a stable ref so the countdown interval can call startRoll without
  // stale-closure issues.
  useEffect(() => { startRollRef.current = startRoll })

  // Processing countdown: 8 → 0, shown in the top banner during isRolling.
  useEffect(() => {
    if (!isRolling || mode !== 'random') return
    setProcessingCountdown(8)
    const id = setInterval(() => setProcessingCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [isRolling, mode])

  // Cycle dice faces in the processing banner (left and right offset by 3).
  useEffect(() => {
    if (!isRolling || mode !== 'random') return
    setProcessingDiceIdx(0)
    const id = setInterval(() => setProcessingDiceIdx(i => (i + 1) % SYMBOLS.length), 250)
    return () => clearInterval(id)
  }, [isRolling, mode])

  // ── openRound: user clicks ວາງເດີມພັນ → enables the board for 30 seconds.
  const openRound = useCallback(() => {
    if (isRoundOpen || isRolling || isRevealingResult || resultModal) return
    ensureBgMusic()
    setIsRoundOpen(true)
    setBetCountdown(15)
    if (betCountdownIntervalRef.current) clearInterval(betCountdownIntervalRef.current)
    betCountdownIntervalRef.current = setInterval(() => {
      setBetCountdown(prev => {
        const next = prev - 1
        if (next <= 0) {
          clearInterval(betCountdownIntervalRef.current!)
          betCountdownIntervalRef.current = null
          setTimeout(() => startRollRef.current?.(), 50)
          return 0
        }
        return next
      })
    }, 1000)
  }, [isRoundOpen, isRolling, isRevealingResult, resultModal, ensureBgMusic])

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
      sum: currentSumBets,
    }
    const betTotal =
      snapshot.symbol.reduce((s, b) => s + b.amount, 0) +
      snapshot.range.reduce((s, b) => s + b.amount, 0) +
      snapshot.pair.reduce((s, b) => s + b.amount, 0) +
      snapshot.sum.reduce((s, b) => s + b.amount, 0)

    // Defensive: don't even hit the server if the staged total exceeds the
    // wallet balance the store knows about. This avoids a confusing
    // "Insufficient balance" round-trip when the UI got out of sync with the
    // server (e.g. after a background revalidation reset the optimistic
    // chip-deduction).
    const walletKey = user.activeWallet
    const walletBalance = user.balances[walletKey]
    if (betTotal > walletBalance) {
      toast.error(t('live.betNotPlaced'), {
        description: `${walletKey.toUpperCase()}: ${walletBalance.toLocaleString()} ₭ available, ${betTotal.toLocaleString()} ₭ requested.`,
      })
      return
    }

    const payload = {
      mode: 'LIVE',
      wallet: user.activeWallet === 'real' ? 'REAL' : user.activeWallet === 'promo' ? 'PROMO' : 'DEMO',
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
        sum: snapshot.sum.map(b => ({ sum: b.sum, amount: b.amount })),
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
    setCurrentSumBets([])
    setPendingCell(null)
    setLastBetTotal(betTotal)
    soundEnabled && playClick()
    toast.success(t('live.betsPlacedTitle'), {
      description: t('live.betsPlacedDesc', { amount: betTotal.toLocaleString() }),
    })
  }, [mode, livePhase, authUser, hasAnyBet, currentBets, currentRangeBets, currentPairBets, currentSumBets, user.activeWallet, playRoundFetcher, soundEnabled, t])

  // RANDOM mode: apply the result once animation is done.
  // Fast path  → pendingDiceRef has pre-computed dice (zero server wait).
  // Slow path  → wait for the real-time /api/pick-dice fetcher response.
  // Either way, /api/save-round is fired in the background so the user never
  // waits for the DB write.
  useEffect(() => {
    if (!rollAnimationDone) return

    // ── Fast path ──────────────────────────────────────────────────────────
    if (pendingDiceRef.current) {
      const { dice, token } = pendingDiceRef.current
      pendingDiceRef.current = null
      setRollAnimationDone(false)
      applyResult(dice.map(d => d.toLowerCase() as SymbolKey))
      fetch('/api/save-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then(() => revalidator.revalidate())
        .catch(() => revalidator.revalidate())
      return
    }

    // ── Slow path ──────────────────────────────────────────────────────────
    if (playRoundFetcher.state !== 'idle') return
    const data = playRoundFetcher.data as { ok?: boolean; dice?: string[]; token?: string; error?: string } | undefined
    if (!data) return
    setRollAnimationDone(false)
    if (data.error) {
      stopRollSound()
      setIsRolling(false)
      setMessage(data.error)
      return
    }
    if (data.ok && data.dice) {
      applyResult(data.dice.map(d => d.toLowerCase() as SymbolKey))
      if (data.token) {
        fetch('/api/save-round', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: data.token }),
        })
          .then(() => revalidator.revalidate())
          .catch(() => revalidator.revalidate())
      }
    }
  }, [rollAnimationDone, playRoundFetcher.state, playRoundFetcher.data, applyResult, revalidator, stopRollSound])

  // LIVE mode only: show server errors (insufficient balance, no open round, betting closed).
  useEffect(() => {
    if (playRoundFetcher.state !== 'idle') return
    const data = playRoundFetcher.data
    if (!data) return
    if (mode === 'live') {
      if (data.error) {
        toast.error(t('live.betNotPlaced'), { description: data.error })
      } else if (data.ok) {
        revalidator.revalidate()
      }
    }
  }, [playRoundFetcher.state, playRoundFetcher.data, revalidator, t, mode])

  // Demo-reset response — DB now holds 1,000,000. Update the in-memory store
  // and revalidate silently. A ref guards against the effect re-firing when
  // the revalidator object reference changes mid-revalidation.
  useEffect(() => {
    if (resetDemoFetcher.state !== 'idle') {
      resetDemoHandled.current = false
      return
    }
    const data = resetDemoFetcher.data
    if (!data || resetDemoHandled.current) return
    resetDemoHandled.current = true
    if (data.ok) {
      storeSetWalletBalance('demo', DEMO_RESET_AMOUNT)
      if (user.activeWallet === 'demo') setBalance(DEMO_RESET_AMOUNT)
      revalidator.revalidate()
    }
  }, [resetDemoFetcher.state, resetDemoFetcher.data, revalidator, user.activeWallet])

  // Mode toggle: switching modes clears any staged bets to avoid mixing
  // RANDOM (client-rolled) and LIVE (server-attached) bets. Switching INTO
  // LIVE also forces a loader revalidation so we pick up the admin's current
  // round state (a `round:started` event might have fired before we joined
  // presence-live, in which case the local snapshot is already stale).
  const selectMode = useCallback((next: 'random' | 'live') => {
    setMode(prev => {
      if (prev === next) return prev
      try { localStorage.setItem('fpc_play_mode', next) } catch { /* ignore */ }
      if (next === 'live') revalidator.revalidate()
      return next
    })
    setCurrentBets([])
    setCurrentRangeBets([])
    setCurrentPairBets([])
    setCurrentSumBets([])
    setPendingCell(null)
  }, [revalidator])

  const startTour = useCallback(() => {
    modeBeforeTourRef.current = mode
    if (mode !== 'random') selectMode('random')
    setTourOpen(true)
  }, [mode, selectMode])

  const endTour = useCallback((completed: boolean) => {
    setTourOpen(false)
    // Local flag for anonymous visitors (no account to persist to) and as a
    // fast local cache for authed users so a quick re-mount doesn't re-show
    // it before the server round-trip below resolves.
    try { localStorage.setItem(TOUR_STORAGE_KEY, 'true') } catch { /* ignore */ }
    // Server-side flag for authed users — durable across devices/browsers,
    // survives clearing local storage. "Seen" applies whether they finished
    // or skipped; either way it shouldn't auto-play again for this account.
    if (authUser) {
      fetch('/api/mark-tour-seen', { method: 'POST' }).catch(() => { /* best-effort */ })
    }
    if (modeBeforeTourRef.current !== 'random') selectMode(modeBeforeTourRef.current)
    if (completed) {
      confetti({ particleCount: 100, spread: 90, angle: 90, origin: { x: 0.5, y: 0.3 }, startVelocity: 40 })
    }
  }, [authUser, selectMode])

  // Auto-launch exactly once per account (server-side `hasSeenTour`), or once
  // per browser for anonymous visitors (localStorage — there's no account to
  // tie it to). Runs after mount only, so SSR/hydration stay in sync.
  useEffect(() => {
    const alreadySeen = authUser
      ? loaderData.hasSeenTour
      : (() => {
        try { return localStorage.getItem(TOUR_STORAGE_KEY) === 'true' } catch { return true }
      })()
    if (alreadySeen) return
    const id = setTimeout(() => startTour(), 600)
    return () => clearTimeout(id)
    // Mount-only — checks the server flag (authed) or localStorage
    // (anonymous) once; startTour/authUser/loaderData are stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-open the bet sheet when a new round starts; auto-close + clear state when it ends.
  // Bet-locked users never get the board (it stays closed the whole round).
  useEffect(() => {
    if (livePhase === 'betting' && !betLocked) {
      setBetSheetOpen(true)
      // Clear any leftover staged bets + pending pair selection from the previous round
      setPendingCell(null)
      setCurrentBets([])
      setCurrentRangeBets([])
      setCurrentPairBets([])
      setCurrentSumBets([])
      setCancelledBetIds(new Set())
    } else {
      setBetSheetOpen(false)
      setPendingCell(null)
    }
  }, [livePhase, betLocked])

  // When a cancel-bet succeeds, update the local balance and revalidate.
  useEffect(() => {
    if (cancelBetFetcher.state !== 'idle') return
    const data = cancelBetFetcher.data
    if (!data?.ok || data.newBalance == null) return
    storeSetBalance(data.newBalance)
    setBalance(data.newBalance)
    revalidator.revalidate()
  }, [cancelBetFetcher.state, cancelBetFetcher.data, revalidator])

  // Measure the sheet grid so SVG pair lines can be drawn accurately.
  useEffect(() => {
    if (!betSheetOpen || !sheetGridRef.current) return
    const { offsetWidth, offsetHeight } = sheetGridRef.current
    setSheetGridSize({ w: offsetWidth, h: offsetHeight })
  }, [betSheetOpen])

  // (Webcam getUserMedia removed — stream is now an external iframe embed on user side.)

  // Observe the betting grid's pixel size so we can draw pair connector lines.
  // Re-runs when mode/livePhase changes so the measurement fires after the grid
  // mounts (it's conditionally rendered — not present until betting opens).
  useEffect(() => {
    if (!gridRef.current) return
    const el = gridRef.current
    const update = () => setGridSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, livePhase])

  // Auto-fade the winner highlight 5s after a roll lands, and also clear it
  // immediately if a new roll starts (so the previous round's highlight
  // doesn't bleed into the next one).
  useEffect(() => {
    if (isRolling) {
      setWinnerHighlight(false)
      return
    }
    if (!winnerHighlight) return
    const id = setTimeout(() => setWinnerHighlight(false), 5000)
    return () => clearTimeout(id)
  }, [winnerHighlight, isRolling])

  const displayDice = isRolling ? rollingDice : diceResults

  // Fake viewer count — deterministic so all users see the same number at the
  // same time. Uses two sine waves at different frequencies for natural drift.
  // Stays between 500-650 and updates every 30 seconds.
  const getFakeViewers = () => {
    const t = Date.now() / (10 * 60 * 1000)  // time in 10-min units
    const v = Math.sin(t * 2.31 + 1.47) * 0.6 + Math.sin(t * 0.73 + 0.83) * 0.4
    return Math.round(570 + v * 70)  // 500 – 640
  }
  const [fakeViewers, setFakeViewers] = useState(getFakeViewers)
  useEffect(() => {
    // Only tick while in live mode — save battery when not watching
    if (mode !== 'live') return
    const id = setInterval(() => setFakeViewers(getFakeViewers()), 30_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Dice display: 3 dice + SUM badge + win badge. Used in both RANDOM and LIVE modes.
  // Two visual states only:
  //   • Rolling/waiting  → bouncing dice (random symbols cycling)
  //   • Result revealed  → golden pulse glow on the actual dice
  const diceDisplay = (
    <>
      <div className="flex items-center gap-4">
        {displayDice.length > 0
          ? displayDice.map((sym, i) => (
            <div
              key={i}
              className={`relative overflow-hidden rounded-xl bg-white shadow-2xl ${isRolling ? 'animate-bounce' : ''}`}
              style={{
                width: 72, height: 72,
                border: '1px solid #f59e0b',
                animationDelay: `${i * 80}ms`,
              }}
            >
              <img src={`/symbols/${sym}.png`} alt={sym} className="absolute inset-0 h-full w-full object-contain p-1" />
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

      {!isRolling && !isRevealingResult && diceResults.length > 0 && (
        <div
          className="rounded-full px-4 py-0.5 text-xs font-bold"
          style={{ background: 'rgba(30,0,64,0.6)', color: '#fde68a', border: '1px solid #a78bfa' }}
        >
          ຄະແນນລວມ: {diceSum}
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

      {/* ── LIVE FULL-SCREEN OVERLAY (mobile only) ──────────────────────── */}
      {mode === 'live' && (
        <div className="fixed inset-0 z-[100] bg-black md:hidden">
          {/* Full-screen video — transform forces a new compositing layer on
              iOS Safari, preventing the blank/black iframe rendering bug that
              occurs when an iframe sits inside a position:fixed parent. */}
          <div className="absolute inset-0" style={{ WebkitTransform: 'translate3d(0,0,0)', transform: 'translate3d(0,0,0)' }}>
            {activeStreamUrl ? (
              <LiveStreamBox
                rawUrl={activeStreamUrl}
                waitingText={t('live.waitingHostStream')}
                fullScreen
              />
            ) : (
              <div className="flex h-full items-center justify-center" style={{ background: '#0a0014' }}>
                <LiveScheduleCard schedule={loaderData.schedule} />
              </div>
            )}
          </div>

          {/* Top cover — hides platform native UI (FB viewer avatars/count) that
              bleeds through the iframe. Solid at top, fades out quickly. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-25"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 60%, rgba(0,0,0,0.7) 80%, transparent 100%)' }} />
          {/* Bottom gradient */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }} />

          {/* ── Floating header ── */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 8 }}>
            {/* Left: avatar (name hidden for privacy) */}
            <div className="relative z-10 flex items-center gap-2 min-w-0">
              <button
                onClick={() => setOverlayProfileOpen(v => !v)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: '#4c1d95', border: '1px solid #a78bfa', color: '#e9d5ff' }}
              >
                {initials || '?'}
              </button>
              {overlayProfileOpen && (
                <ProfileDropdown name={displayName} onClose={() => setOverlayProfileOpen(false)} competitionEnabled={competitionMenuVisible} competitionType={loaderData.competitionType} onJoinGroup={() => setJoinGroupOpen(true)} />
              )}
            </div>

            {/* Center: mode selector — uses its own state to avoid conflicting with the main header */}
            <div className="relative z-10">
              <button
                onClick={() => { playClick(); setOverlayModeOpen(v => !v) }}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold"
                style={{ background: 'rgba(220,38,38,0.85)', color: '#fff', border: '1px solid #fca5a5' }}
              >
                {t('game.modeLive')}
                <ChevronDown size={10} style={{ transform: overlayModeOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {overlayModeOpen && (
                <PickerDropdown
                  items={[{ key: 'random', label: t('game.modeSelf') }, { key: 'live', label: t('game.modeLive') }]}
                  active={mode}
                  onSelect={key => { selectMode(key as 'random' | 'live'); setOverlayModeOpen(false) }}
                  onClose={() => setOverlayModeOpen(false)}
                />
              )}
            </div>

            {/* Right: wallet + balance */}
            <div className="relative z-10 flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => { if (isAnonymous) { setLoginOpen(true) } else { setOverlayWalletOpen(v => !v) } }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  background: user.activeWallet === 'demo' ? 'rgba(76,29,149,0.8)' : user.activeWallet === 'real' ? 'rgba(180,83,9,0.8)' : 'rgba(22,163,74,0.8)',
                  color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                }}>
                {user.activeWallet.toUpperCase()}
                <ChevronDown size={9} />
              </button>
              {overlayWalletOpen && (
                <PickerDropdown
                  items={[
                    { key: 'real', label: t('menu.realAccount') },
                    // Demo is always shown in live mode (competition uses live demo play)
                    { key: 'demo', label: t('menu.demoAccount') },
                    // PROMO in live mode: only when real balance is 0
                    ...((user.balances.promo ?? 0) > 0 && (user.balances.real ?? 0) === 0 ? [{ key: 'promo', label: t('menu.promoAccount') }] : []),
                  ]}
                  active={user.activeWallet}
                  align="right"
                  onSelect={key => {
                    const next = key as 'demo' | 'real' | 'promo'
                    setCurrentBets([]); setCurrentRangeBets([]); setCurrentPairBets([]); setCurrentSumBets([]); setPendingCell(null)
                    switchWallet(next); setBalance(user.balances[next])
                    setOverlayWalletOpen(false)
                  }}
                  onClose={() => setOverlayWalletOpen(false)}
                />
              )}
              <a href="/wallet" className="text-sm font-bold text-white">{formatAmount(balance)}</a>
            </div>
          </div>

          {/* ── LIVE badge + viewer count + confirmed bets feed below it ── */}
          <div className="absolute left-3 flex flex-col gap-1.5" style={{ top: 64 }}>
            <div className="flex items-center gap-1.5">
              <span className="flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold"
                style={{ background: 'rgba(220,38,38,0.9)', color: '#fff' }}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                LIVE
              </span>
              {/* Fake viewer count — only while stream is active */}
              {activeStreamUrl && (
                <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <Eye size={9} style={{ color: '#f87171' }} />
                  {fakeViewers.toLocaleString()}
                </span>
              )}
            </div>
            {/* Confirmed bets — shown during both betting and awaiting_result; hidden when idle */}
            {myLiveBets.length > 0 && (livePhase === 'betting' || livePhase === 'awaiting_result') && (
              <div className="flex flex-col gap-1">
                {myLiveBets.filter(b => !cancelledBetIds.has(b.id)).map(b => {
                  const rangeColor = b.range === 'LOW' ? '#4ade80' : b.range === 'HIGH' ? '#f87171' : '#fbbf24'
                  const RangeIcon = b.range === 'LOW' ? ArrowDown : b.range === 'HIGH' ? ArrowUp : ArrowUpDown
                  return (
                    <div key={b.id} className="flex items-center gap-1">
                      {/* Bet pill */}
                      <div className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold"
                        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
                        {b.kind === 'SYMBOL' && b.symbol && (
                          <>
                            <img src={`/symbols/${b.symbol.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                            <span>{symName(b.symbol, t)}</span>
                          </>
                        )}
                        {b.kind === 'PAIR' && b.pairA && b.pairB && (
                          <>
                            <img src={`/symbols/${b.pairA.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                            <span>{symName(b.pairA, t)}</span>
                            <span className="opacity-60">+</span>
                            <img src={`/symbols/${b.pairB.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                            <span>{symName(b.pairB, t)}</span>
                          </>
                        )}
                        {b.kind === 'RANGE' && b.range && (
                          <>
                            <RangeIcon size={11} style={{ color: rangeColor }} className="shrink-0" />
                            <span style={{ color: rangeColor }}>{b.range === 'LOW' ? t('game.low') : b.range === 'HIGH' ? t('game.high') : t('game.middle')}</span>
                          </>
                        )}
                        {b.kind === 'SUM' && b.exactSum != null && (
                          <span className="font-bold" style={{ color: '#fbbf24' }}>ເລກ {b.exactSum}</span>
                        )}
                        <span className="ml-0.5 font-bold" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}₭</span>
                      </div>
                      {/* Cancel button — only visible during betting phase */}
                      {livePhase === 'betting' && (
                        <button
                          onClick={() => setCancelConfirmBet({ id: b.id, amount: b.amount })}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                          style={{ background: 'rgba(220,38,38,0.8)', color: '#fff' }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Cancel bet confirmation modal */}
            {cancelConfirmBet && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
                style={{ background: 'rgba(0,0,0,0.75)' }}
                onClick={() => setCancelConfirmBet(null)}>
                <div className="w-full max-w-xs rounded-2xl p-5"
                  style={{ background: '#1e0040', border: '1px solid #7c3aed', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
                  onClick={e => e.stopPropagation()}>
                  {/* Title — Lao + Thai */}
                  <h3 className="mb-1 text-center text-base font-bold" style={{ color: '#fde68a' }}>
                    {t('bet.cancelTitle')}
                  </h3>
                  {/* Description — Lao + Thai */}
                  <p className="mt-3 text-center text-sm" style={{ color: '#e9d5ff' }}>
                    {t('bet.cancelDesc', { amount: cancelConfirmBet.amount.toLocaleString() })}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setCancelConfirmBet(null)}
                      className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                      style={{ background: '#2d1b4e', color: '#a78bfa', border: '1px solid #4c1d95' }}>
                      {t('bet.cancelNo')}
                    </button>
                    <button
                      onClick={() => {
                        setCancelledBetIds(prev => new Set([...prev, cancelConfirmBet.id]))
                        cancelBetFetcher.submit(
                          { betId: cancelConfirmBet.id },
                          { method: 'post', action: '/api/cancel-live-bet', encType: 'application/json' }
                        )
                        setCancelConfirmBet(null)
                      }}
                      className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                      style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', color: '#fff', border: '1px solid #fca5a5' }}>
                      {t('bet.cancelConfirm')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Status / timer badge ── */}
          <div className="absolute right-3" style={{ top: 64 }}>
            {livePhase === 'betting' ? (
              <span className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: liveTimer <= 10 ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)', color: '#fff' }}>
                {t('live.statusBetting', { n: String(liveTimer) })}
              </span>
            ) : livePhase !== 'idle' ? (
              <span className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: 'rgba(234,88,12,0.9)', color: '#fff' }}>
                {t('live.bettingClosed')}
              </span>
            ) : activeStreamUrl ? (
              <span className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: 'rgba(76,29,149,0.9)', color: '#fff' }}>
                {t('live.waitingHostStart')}
              </span>
            ) : null}
          </div>

          {/* ── Dice overlay (awaiting_result) ── */}
          {livePhase === 'awaiting_result' && (
            <div className="absolute inset-x-0 flex flex-col items-center gap-3 px-4"
              style={{ bottom: 20, paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <DiceReveal dice={revealedDice} />
            </div>
          )}

          {/* ── Idle waiting message — only when a stream is active (schedule card hides it) ── */}
          {livePhase === 'idle' && activeStreamUrl && (
            <div className="absolute inset-x-0 flex justify-center" style={{ bottom: 120 }}>
              <span className="rounded-xl px-4 py-2 text-sm font-semibold"
                style={{ background: 'rgba(0,0,0,0.6)', color: '#c4b5fd' }}>
                {t('live.waitingHostStart')}
              </span>
            </div>
          )}

          {/* ── Bet summary chips (floating above FAB) ── */}
          {hasAnyBet && livePhase === 'betting' && !betSheetOpen && (
            <div className="absolute inset-x-0 flex flex-wrap justify-center gap-1.5 px-4" style={{ bottom: 88 }}>
              {currentBets.map(b => (
                <div key={`fs-${b.cell}`} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fde68a', border: '1px solid #dc2626' }}>
                  <img src={`/symbols/${b.symbol}.png`} alt={b.symbol} className="h-3 w-3 rounded object-contain bg-white" />
                  {b.amount.toLocaleString()}
                </div>
              ))}
              {currentRangeBets.map((b, i) => (
                <div key={`fsr-${i}`} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fde68a', border: '1px solid #7c3aed' }}>
                  {b.range.toUpperCase()} {b.amount.toLocaleString()}
                </div>
              ))}
              {currentPairBets.map((b, i) => (
                <div key={`fsp-${i}`} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fde68a', border: '1px solid #2563eb' }}>
                  <img src={`/symbols/${b.a}.png`} alt={b.a} className="h-3 w-3 rounded object-contain bg-white" />
                  <img src={`/symbols/${b.b}.png`} alt={b.b} className="h-3 w-3 rounded object-contain bg-white" />
                  {b.amount.toLocaleString()}
                </div>
              ))}
              {currentSumBets.map((b) => (
                <div key={`fss-${b.sum}`} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fde68a', border: '1px solid #d97706' }}>
                  ເລກ {b.sum} : {b.amount.toLocaleString()}
                </div>
              ))}
            </div>
          )}

          {/* ── Bet-locked: no betting board for this user. Show a neutral
                "round starting" notice so it reads like a normal wait, not a lock. ── */}
          {livePhase === 'betting' && betLocked && (
            <div className="absolute inset-x-0 flex justify-center px-4" style={{ bottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
              <span className="rounded-full px-4 py-2 text-xs font-semibold text-center"
                style={{ background: 'rgba(0,0,0,0.6)', color: '#c4b5fd' }}>
                {t('live.betLocked')}
              </span>
            </div>
          )}

          {/* ── FAB buttons ── */}
          {livePhase === 'betting' && !betSheetOpen && !betLocked && (
            <div className="absolute right-4 flex flex-col items-end gap-2"
              style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)', paddingBottom: 8 }}>
              {hasAnyBet && (
                <button onClick={placeLiveBets} disabled={playRoundFetcher.state !== 'idle'}
                  className="rounded-xl px-5 py-3 text-sm font-bold shadow-2xl disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#16a34a,#14532d)', color: '#fff', border: '2px solid #4ade80' }}>
                  ແທງເລີຍ
                </button>
              )}
              <button onClick={() => setBetSheetOpen(true)}
                className="rounded-xl px-5 py-3 text-sm font-bold shadow-2xl"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4c1d95)', color: '#fff', border: '2px solid #a78bfa', boxShadow: '0 4px 24px rgba(124,58,237,0.7)' }}>
                {myLiveBets.filter(b => !cancelledBetIds.has(b.id)).length > 0 ? 'ວາງເດີມພັນອີກ' : 'ວາງເດີມພັນ'}
              </button>
            </div>
          )}

          {/* ── Sheet backdrop ── */}
          {betSheetOpen && (
            <div className="absolute inset-0 z-10" style={{ background: 'rgba(0,0,0,0.5)' }}
              onClick={() => setBetSheetOpen(false)} />
          )}

          {/* ── Bottom sheet ── */}
          <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl overflow-hidden"
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1e0040',
              maxHeight: '92vh',
              transform: betSheetOpen ? 'translateY(0)' : 'translateY(100%)',
              transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1)',
              paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
            }}>
            {/* Handle + header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="h-1 w-10 rounded-full" style={{ background: '#6d28d9' }} />
              <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>
                {hasAnyBet ? `Total: ${formatAmount(totalBet)}₭` : t('game.placeYourBets')}
              </span>
              <button onClick={() => setBetSheetOpen(false)}>
                <X size={18} style={{ color: '#a78bfa' }} />
              </button>
            </div>

            {/* Full betting grid — symbol/pair grid + range, all in one view */}
            <div className="overflow-y-auto px-4" style={{ maxHeight: 'calc(92vh - 160px)' }}>
              {/* Symbol / pair grid — with SVG pair connector lines */}
              <div className="relative mb-3">
                <div ref={sheetGridRef} className="grid grid-cols-4 gap-2">
                  {BOARD_LAYOUT.map((symbol, idx) => {
                    const bet = currentBets.filter(b => b.cell === idx).reduce((s, b) => s + b.amount, 0)
                    const pairBet = currentPairBets.filter(b => b.cellA === idx || b.cellB === idx).reduce((s, b) => s + b.amount, 0)
                    const isPending = pendingCell === idx
                    const canPair = pendingCell !== null && pendingCell !== idx && areAdjacent(pendingCell, idx) && BOARD_LAYOUT[pendingCell] !== symbol
                    const isWinner = !isRolling && diceResults.length > 0 && diceResults.includes(symbol)
                    const hasBoth = bet > 0 && pairBet > 0
                    const hasSingle = bet > 0
                    const hasPairOnly = pairBet > 0 && bet === 0
                    return (
                      <button key={idx} onClick={() => handleBoardTap(idx)}
                        disabled={bettingLocked || (pendingCell === null && balance < selectedChip)}
                        className="relative flex aspect-square flex-col items-center justify-center rounded-xl transition-all disabled:opacity-50"
                        style={{
                          background: isPending
                            ? 'rgba(167,139,250,0.3)'
                            : canPair
                              ? 'rgba(37,99,235,0.2)'
                              : isWinner
                                ? 'rgba(250,204,21,0.2)'
                                : hasBoth
                                  ? 'rgba(168,85,247,0.18)'
                                  : hasSingle
                                    ? 'rgba(220,38,38,0.12)'
                                    : hasPairOnly
                                      ? 'rgba(250,204,21,0.12)'
                                      : '#fff',
                          border: `2px solid ${isPending ? '#a78bfa'
                            : canPair ? '#60a5fa'
                              : isWinner ? '#facc15'
                                : hasBoth ? '#a855f7'
                                  : hasSingle ? '#dc2626'
                                    : hasPairOnly ? '#facc15'
                                      : '#e2e8f0'
                            }`,
                          boxShadow: isPending
                            ? '0 0 16px rgba(167,139,250,0.5)'
                            : isWinner
                              ? '0 0 16px rgba(250,204,21,0.4)'
                              : hasBoth
                                ? '0 0 10px rgba(168,85,247,0.4)'
                                : hasSingle
                                  ? '0 0 10px rgba(220,38,38,0.35)'
                                  : hasPairOnly
                                    ? '0 0 10px rgba(250,204,21,0.35)'
                                    : '0 1px 3px rgba(0,0,0,0.15)',
                        }}>
                        <img src={`/symbols/${symbol}.png`} alt={symbol} className="h-10 w-10 object-contain" />
                        <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold"
                          style={{ background: 'rgba(76,29,149,0.9)', color: '#fde68a', border: '1px solid #a78bfa' }}>
                          {SYMBOL_VALUES[symbol]}
                        </div>
                        {bet > 0 && (
                          <div className="absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                            style={{ background: '#dc2626', color: '#fff' }}>
                            {formatAmount(bet)}
                          </div>
                        )}
                        {pairBet > 0 && (
                          <div className="absolute top-1 left-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                            style={{ background: '#2563eb', color: '#fff' }}>
                            {formatAmount(pairBet)}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* SVG pair connector lines */}
                {sheetGridSize.w > 0 && currentPairBets.length > 0 && (() => {
                  const GAP = 8
                  const cols = 4
                  const cellW = (sheetGridSize.w - (cols - 1) * GAP) / cols
                  const cellH = cellW // aspect-square
                  const rowH = cellH + GAP
                  const centerOf = (i: number) => ({
                    x: (i % cols) * (cellW + GAP) + cellW / 2,
                    y: Math.floor(i / cols) * rowH + cellH / 2,
                  })
                  return (
                    <svg className="pointer-events-none absolute inset-0"
                      width={sheetGridSize.w} height={cellH * 2 + GAP}
                      style={{ zIndex: 10 }}>
                      {currentPairBets.map((pb, pi) => {
                        const c1 = centerOf(pb.cellA)
                        const c2 = centerOf(pb.cellB)
                        const color = pairColor(pb.cellA, pb.cellB)
                        return (
                          <g key={pi}>
                            <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                              stroke={color} strokeWidth={4} strokeLinecap="round" opacity={0.9} />
                            <circle cx={c1.x} cy={c1.y} r={6} fill={color} opacity={0.95} />
                            <circle cx={c2.x} cy={c2.y} r={6} fill={color} opacity={0.95} />
                          </g>
                        )
                      })}
                    </svg>
                  )
                })()}
              </div>{/* end relative wrapper */}

              {/* Pair hint */}
              <p className="mb-3 text-center text-[10px]" style={{ color: '#a78bfa' }}>
                {pendingCell !== null
                  ? `${symName(BOARD_LAYOUT[pendingCell], t)} — ${t('game.tapAdjacent').split('.')[0]}`
                  : t('game.pairHint')}
              </p>

              {/* Range/Sum bets — numbers 3-18 for LIVE, LOW/MID/HIGH for RANDOM */}
              {mode === 'live' ? (
                <div className="pb-2">
                  <div className="mb-1 flex items-center justify-between text-[9px]" style={{ color: '#c4b5fd' }}>
                    <span>ສູງສຸດ 3 ເລກ · ×3 ກຳໄລ (<span style={{ color: '#fca5a5' }}>3,7,11,15 = ×5</span>)</span>
                    <span>{currentSumBets.length}/3</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1">
                    {Array.from({ length: 16 }, (_, i) => i + 3).map(n => {
                      const bet = getSumBetAmount(n)
                      const isWinner = !isRolling && diceResults.length > 0 && diceSum === n
                      const isSelected = currentSumBets.some(b => b.sum === n)
                      const maxReached = currentSumBets.length >= 3 && !isSelected
                      const isSpecial = [3, 7, 11, 15].includes(n)
                      return (
                        <button key={n} onClick={() => placeSumBet(n)}
                          disabled={bettingLocked || balance < selectedChip || maxReached}
                          className="relative flex flex-col items-center justify-center rounded py-1 font-bold disabled:opacity-40"
                          style={{
                            background: isWinner ? 'rgba(250,204,21,0.3)' : isSelected ? 'rgba(124,58,237,0.5)' : isSpecial ? 'rgba(185,28,28,0.85)' : 'rgba(30,0,64,0.6)',
                            border: `1px solid ${isWinner ? '#facc15' : isSelected ? '#a78bfa' : isSpecial ? '#ef4444' : '#4c1d95'}`,
                            color: isWinner ? '#facc15' : '#fff',
                          }}>
                          <div className="text-[10px]">{n}</div>
                          <div className="text-[7px] opacity-70">{isSpecial ? '×5' : '×3'}</div>
                          {bet > 0 && (
                            <div className="absolute -top-1 -right-1 rounded-full px-0.5 text-[6px] font-bold"
                              style={{ background: '#dc2626', color: '#fff' }}>
                              {formatAmount(bet)}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 pb-2">
                  {RANGE_CONFIG.map(r => {
                    const bet = currentRangeBets.filter(b => b.range === r.key).reduce((s, b) => s + b.amount, 0)
                    const isWinner = !isRolling && diceResults.length > 0 && (() => {
                      const sum = diceResults.reduce((s, sym) => s + SYMBOL_VALUES[sym], 0)
                      return sum >= r.min && sum <= r.max
                    })()
                    return (
                      <button key={r.key} onClick={() => placeRangeBet(r.key)}
                        disabled={bettingLocked || balance < selectedChip}
                        className="relative flex flex-col items-center justify-center rounded-xl py-3 text-sm font-bold disabled:opacity-50"
                        style={{ background: isWinner ? 'rgba(250,204,21,0.25)' : r.bg, border: `1px solid ${isWinner ? '#facc15' : r.border}`, color: r.color }}>
                        <div className="font-semibold">{r.key === 'low' ? t('game.low') : r.key === 'middle' ? t('game.middle') : t('game.high')}</div>
                        <div className="text-[10px] opacity-75">({r.range})</div>
                        <div className="text-[10px] opacity-75">{t('game.pays', { x: rangeMultiplier(r.key, loaderData.payoutConfig) - 1 })}</div>
                        {bet > 0 && (
                          <div className="absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                            style={{ background: '#dc2626', color: '#fff' }}>
                            {formatAmount(bet)}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Chip selector + actions */}
            <div className="border-t px-3 py-3" style={{ borderColor: '#4c1d95' }}>
              {/* px-2 + py-2 give the scaled active chip room so it isn't clipped */}
              <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-2">
                {CHIP_CONFIG.map(chip => (
                  <button key={chip.value}
                    onClick={() => { soundEnabled && playCoin(); setSelectedChip(chip.value) }}
                    disabled={randomBoardLocked}
                    className={`relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full bg-gradient-to-b ${chip.colors} font-bold text-white transition-all disabled:opacity-40`}
                    style={{
                      border: selectedChip === chip.value ? '2px solid #fff' : `1px solid ${chip.border}`,
                      transform: selectedChip === chip.value ? 'scale(1.15)' : 'scale(1)',
                      boxShadow: selectedChip === chip.value ? `0 0 12px ${chip.border}` : '0 2px 4px rgba(0,0,0,0.4)',
                      fontSize: chip.value >= 100_000 ? 8 : 9,
                    }}>
                    {chip.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={undoBet} disabled={!hasAnyBet && pendingCell === null}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40"
                  style={{ background: 'linear-gradient(180deg,#f59e0b,#b45309)', color: '#1e0040', border: '1px solid #fcd34d' }}>
                  {t('game.undo')}
                </button>
                <button onClick={() => { placeLiveBets(); setBetSheetOpen(false) }}
                  disabled={!hasAnyBet || playRoundFetcher.state !== 'idle'}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#16a34a,#14532d)', color: '#fff', border: '2px solid #4ade80' }}>
                  ແທງເລີຍ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── END LIVE OVERLAY ───────────────────────────────────────────── */}

      <header
        className="flex items-center justify-between px-4 py-2"
        style={{ background: '#1e0040', borderBottom: '1px solid #a78bfa' }}
      >
        <div className='flex items-center gap-2'>
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
                className="flex items-center gap-2.5 rounded-full sm:rounded-xl p-1 sm:p-2 transition-all hover:opacity-90"
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
                  className="flex items-center gap-2.5 rounded-full sm:rounded-xl p-1 sm:p-2 transition-all hover:opacity-90"
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
                  <ProfileDropdown name={displayName} onClose={() => setProfileOpen(false)} competitionEnabled={competitionMenuVisible} competitionType={loaderData.competitionType} onJoinGroup={() => setJoinGroupOpen(true)} />
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { playClick(); startTour() }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-opacity hover:opacity-80"
              style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#fde68a' }}
              title={t('tour.replay')}
              aria-label={t('tour.replay')}
            >
              ?
            </button>

            {/* Mode dropdown — Self-play / Live, with the same accent colors
                the old toggle button used. */}
            <div className="relative">
              <button
                data-tour="mode-switcher"
                onClick={() => { playClick(); setModeOpen(v => !v) }}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                style={{
                  background: mode === 'live'
                    ? 'linear-gradient(180deg, #dc2626 0%, #7f1d1d 100%)'
                    : 'linear-gradient(180deg, #7c3aed 0%, #4c1d95 100%)',
                  color: '#fff',
                  border: `1px solid ${mode === 'live' ? '#fca5a5' : '#a78bfa'}`,
                }}
                title={t('menu.mode')}
                aria-haspopup="menu"
                aria-expanded={modeOpen}
              >
                {mode === 'random' && liveRoundActive && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full"
                    style={{ background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.9)' }}
                  />
                )}
                <span>{mode === 'live' ? t('game.modeLive') : t('game.modeSelf')}</span>
                <ChevronDown size={12} style={{ transform: modeOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 120ms' }} />
              </button>
              {modeOpen && (
                <PickerDropdown
                  items={[
                    { key: 'random', label: t('game.modeSelf') },
                    { key: 'live', label: t('game.modeLive') },
                  ]}
                  active={mode}
                  onSelect={key => selectMode(key as 'random' | 'live')}
                  onClose={() => setModeOpen(false)}
                />
              )}
            </div>
            <button
              onClick={() => { playClick(); ensureBgMusic() }}
              className="hidden md:inline-flex rounded-full px-4 py-1.5 text-xs font-bold"
              style={{ background: 'linear-gradient(180deg, #16a34a 0%, #14532d 100%)', color: '#bbf7d0', border: '1px solid #4ade80' }}
            >
              {t('game.dailyBonus')}
            </button>
            {mode === 'live' ? (
              <span
                className="text-sm font-bold  hidden sm:block rounded-full px-3 py-1"
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
                {livePhase === 'betting' ? t('live.statusBetting', { n: String(liveTimer) }) : t('live.statusWaitingResult')}
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
        </div>

        <div className="flex items-center gap-3">
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
          {/* Combined account + mode dropdown — anonymous users can't pick
              REAL, so tapping the trigger opens the login modal instead. */}
          <div className="relative">
            <button
              data-tour="account-switcher"
              onClick={() => {
                soundEnabled && playClick()
                ensureBgMusic()
                if (isAnonymous) {
                  setLoginHint(t('auth.signInToUseRealWallet'))
                  setLoginOpen(true)
                  return
                }
                setWalletOpen(v => !v)
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold transition-opacity hover:opacity-90"
              style={{
                background: user.activeWallet === 'demo'
                  ? 'linear-gradient(135deg, #4c1d95, #2d1b4e)'
                  : user.activeWallet === 'real'
                    ? 'linear-gradient(135deg, #b45309, #78350f)'
                    : 'linear-gradient(135deg, #16a34a, #15803d)',
                color: user.activeWallet === 'demo' ? '#c4b5fd' : '#fde68a',
                border: `1px ${user.activeWallet === 'demo' ? 'dashed #a78bfa' : user.activeWallet === 'real' ? 'solid #fcd34d' : 'solid #4ade80'}`,
              }}
              title={t('menu.account')}
              aria-haspopup="menu"
              aria-expanded={walletOpen}
            >
              <span>{user.activeWallet === 'demo' ? 'DEMO' : user.activeWallet === 'real' ? 'REAL' : 'PROMO'}</span>
              <ChevronDown size={12} style={{ transform: walletOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 120ms' }} />
            </button>
            {walletOpen && (() => {
              // Per-type self-play wallet restrictions (immediate via local state):
              // DEMO_LIVE: demo hidden from self-play for ALL users (no join needed)
              // REAL_LIVE: real hidden from self-play ONLY for participants
              // REAL_ALL:  no self-play restrictions (participants can use real everywhere)
              const cType = loaderData.competitionType
              const isParticipant = loaderData.isCompetitionParticipant
              const hideDemoSelfPlay = mode === 'random' && competitionEnabled && cType === 'DEMO_LIVE'
              const hideRealSelfPlay = mode === 'random' && competitionEnabled && cType === 'REAL_LIVE' && isParticipant
              const items: { key: string; label: string }[] = [
                ...(!hideRealSelfPlay ? [{ key: 'real', label: t('menu.realAccount') }] : []),
                ...(!hideDemoSelfPlay ? [{ key: 'demo', label: t('menu.demoAccount') }] : []),
              ]
              if ((user.balances.promo ?? 0) > 0) {
                items.push({ key: 'promo', label: t('menu.promoAccount') })
              }
              return (
                <PickerDropdown
                  items={items}
                  active={user.activeWallet}
                  align="right"
                  onSelect={key => {
                    const next = key as 'demo' | 'real' | 'promo'
                    // Clear in-progress bets from the outgoing wallet (they belong to the old balance).
                    setCurrentBets([])
                    setCurrentRangeBets([])
                    setCurrentPairBets([])
                    setCurrentSumBets([])
                    setPendingCell(null)
                    switchWallet(next)
                    setBalance(user.balances[next])
                  }}
                  onClose={() => setWalletOpen(false)}
                />
              )
            })()}
          </div>
          <a href="/wallet" className="text-md font-bold tracking-wider" style={{ color: '#fde68a' }}>
            {formatAmount(balance)}
          </a>
          {user.activeWallet === 'demo' && (
            <button
              onClick={() => {
                soundEnabled && playCoin()
                ensureBgMusic()
                setCurrentBets([])
                setCurrentRangeBets([])
                setCurrentPairBets([])
                setCurrentSumBets([])
                setPendingCell(null)
                if (authUser) {
                  // Authoritative reset — writes to the DB so the new balance
                  // survives logout/login (required for the demo competition).
                  resetDemoFetcher.submit(null, { method: 'post', action: '/api/reset-demo' })
                } else {
                  // Anonymous visitor — no DB wallet, fall back to client-only.
                  resetDemoBalance()
                  setBalance(DEMO_RESET_AMOUNT)
                }
              }}
              disabled={resetDemoFetcher.state !== 'idle'}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                border: '1px dashed #4ade80',
              }}
              title={`Reset demo balance to ${DEMO_RESET_AMOUNT.toLocaleString()} ₭`}
              aria-label="Refresh demo balance"
            >
              <RefreshCw size={12} className={resetDemoFetcher.state !== 'idle' ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </header>

      {/* Nudge banner — tells self-play players a LIVE round is open right
          now. Floats above the board (doesn't affect the fixed-height main
          layout below) and is dismissible per-round via sessionStorage. */}
      {mode === 'random' && liveRoundActive && !liveBannerDismissed && (
        <div className="fixed inset-x-0 top-[58px] z-30 flex justify-center px-3">
          <div
            className="flex w-full max-w-md items-center gap-2 rounded-xl px-3 py-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300"
            style={{ background: 'linear-gradient(135deg, #dc2626, #7f1d1d)', border: '1px solid #fca5a5' }}
          >
            <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: '#fff' }} />
            <span className="flex-1 text-xs font-bold" style={{ color: '#fff' }}>
              {t('game.liveRoundBanner')}
            </span>
            <button
              type="button"
              onClick={() => { playClick(); selectMode('live') }}
              className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold transition-opacity hover:opacity-90"
              style={{ background: '#fff', color: '#7f1d1d' }}
            >
              {t('game.watchLive')}
            </button>
            <button
              type="button"
              onClick={dismissLiveBanner}
              aria-label={t('common.close')}
              className="shrink-0 rounded-full p-1 transition-opacity hover:opacity-80"
              style={{ color: '#fff' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

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
                      <img src={`/symbols/${sym}.png`} alt={sym} className="absolute inset-0 h-full w-full object-contain" />
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          {/* LIVE mode — desktop: side-by-side (content left, small portrait video right).
              Mobile: handled by the full-screen overlay above; this section is hidden there. */}
          {mode === 'live' ? (
            <>
              {/* Desktop-only strip — hidden on mobile (overlay handles it).
                  When not betting, this fills all remaining height so there's no empty space below. */}
              <div className={`hidden md:flex items-stretch gap-0${livePhase !== 'betting' ? ' flex-1' : ''}`}
                style={{ background: '#4c1d95', borderBottom: livePhase === 'betting' ? '1px solid #a78bfa' : 'none', minHeight: 320 }}>
                {/* Left 50%: video centred at natural size */}
                <div className="w-1/2 flex items-start justify-center pt-4 px-3"
                  style={{ borderRight: '1px solid #3730a3' }}>
                  <div className="relative" style={{ width: 240 }}>
                    {activeStreamUrl ? (
                      <LiveStreamBox
                        rawUrl={activeStreamUrl}
                        waitingText={t('live.waitingHostStream')}
                        bgColor="#4c1d95"
                        autoStart
                      >
                        <div className="absolute top-2 left-2 flex items-center gap-1.5">
                          <div className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
                            style={{ background: 'rgba(220,38,38,0.9)', color: '#fff' }}>
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                            LIVE
                          </div>
                          <div className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
                            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
                            <Eye size={9} style={{ color: '#f87171' }} />
                            {fakeViewers.toLocaleString()}
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 rounded-md px-2 py-0.5 text-[9px] font-bold"
                          style={{
                            background: livePhase === 'betting'
                              ? (liveTimer <= 10 ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)')
                              : livePhase === 'awaiting_result' ? 'rgba(234,88,12,0.9)' : 'rgba(76,29,149,0.9)',
                            color: '#fff',
                          }}>
                          {livePhase === 'betting'
                            ? t('live.statusBetting', { n: String(liveTimer) })
                            : livePhase === 'awaiting_result' ? t('live.statusWaitingResult') : t('live.statusNotStarted')}
                        </div>
                      </LiveStreamBox>
                    ) : (
                      <div className="flex items-center justify-center rounded-lg px-2 py-4" style={{ background: '#0a0014', minHeight: 180 }}>
                        <LiveScheduleCard schedule={loaderData.schedule} compact />
                      </div>
                    )}
                  </div>
                </div>
                {/* Right 50%: dice (top-center) + placed bets list */}
                <div className="w-1/2 flex flex-col pt-4 px-4 pb-3 overflow-y-auto">
                  {/* Dice at top-center */}
                  {livePhase === 'awaiting_result' && (
                    <div className="flex justify-center mb-4">
                      <DiceReveal dice={revealedDice} />
                    </div>
                  )}
                  {myLiveBets.filter(b => !cancelledBetIds.has(b.id)).length > 0 ? (
                    <>
                      <div className="mb-2 text-[10px] font-bold" style={{ color: '#a78bfa' }}>
                        {t('result.yourBetsThisRound')}
                      </div>
                      <div className="flex flex-col gap-1">
                        {myLiveBets.filter(b => !cancelledBetIds.has(b.id)).map(b => {
                          const rangeColor = b.range === 'LOW' ? '#4ade80' : b.range === 'HIGH' ? '#f87171' : '#fbbf24'
                          const RangeIcon = b.range === 'LOW' ? ArrowDown : b.range === 'HIGH' ? ArrowUp : ArrowUpDown
                          return (
                            <div key={b.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
                              style={{ background: '#2d1b4e', color: '#e9d5ff' }}>
                              <span className="flex items-center gap-1.5 min-w-0 flex-1">
                                {b.kind === 'SYMBOL' && b.symbol && <>
                                  <img src={`/symbols/${b.symbol.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                                  <span className="truncate">{symName(b.symbol, t)}</span>
                                </>}
                                {b.kind === 'PAIR' && b.pairA && b.pairB && <>
                                  <img src={`/symbols/${b.pairA.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                                  <img src={`/symbols/${b.pairB.toLowerCase()}.png`} alt="" className="h-4 w-4 rounded object-contain bg-white shrink-0" />
                                  <span className="truncate">{symName(b.pairA, t)}+{symName(b.pairB, t)}</span>
                                </>}
                                {b.kind === 'RANGE' && b.range && <>
                                  <RangeIcon size={12} style={{ color: rangeColor }} className="shrink-0" />
                                  <span style={{ color: rangeColor }}>{b.range === 'LOW' ? t('game.low') : b.range === 'HIGH' ? t('game.high') : t('game.middle')}</span>
                                </>}
                                {b.kind === 'SUM' && b.exactSum != null && <>
                                  <span className="shrink-0 font-bold" style={{ color: '#fbbf24' }}>ເລກ {b.exactSum}</span>
                                </>}
                              </span>
                              <span className="shrink-0 font-bold ml-2" style={{ color: '#fde68a' }}>{b.amount.toLocaleString()}₭</span>
                              {livePhase === 'betting' && (
                                <button
                                  onClick={() => {
                                    setCancelledBetIds(prev => new Set([...prev, b.id]))
                                    cancelBetFetcher.submit({ betId: b.id }, { method: 'post', action: '/api/cancel-live-bet', encType: 'application/json' })
                                  }}
                                  className="ml-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                                  style={{ background: 'rgba(220,38,38,0.7)', color: '#fff' }}
                                  title="Cancel bet"
                                >
                                  <X size={9} />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px]" style={{ color: '#6d28d9' }}>
                      {livePhase === 'idle' ? t('live.waitingHostStart') : livePhase === 'betting' ? 'Place your bets below' : t('live.bettingClosed')}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 py-4"
              style={{ background: '#4c1d95', borderBottom: '1px solid #a78bfa', minHeight: '148px' }}
            >
              {diceDisplay}
            </div>
          )}

          {/* Bottom betting grid — hidden on desktop when not betting (strip fills full height) */}
          <div
            className={`p-3 overflow-auto${mode === 'live' && livePhase !== 'betting' ? ' hidden' : ' flex-1'}`}
            style={{
              background: '#7c3aed',
              filter: randomBoardLocked ? 'blur(2px) grayscale(0.8)' : 'none',
              opacity: randomBoardLocked ? 0.45 : 1,
              pointerEvents: randomBoardLocked ? 'none' : 'auto',
              transition: 'filter 0.3s, opacity 0.3s',
            }}
          >
            {mode === 'live' && livePhase !== 'betting' ? null : (<>
              <div
                ref={gridRef}
                data-tour="bet-board"
                className="relative mx-auto grid grid-cols-4 gap-1.5"
                style={{ maxWidth: 420 }}
              >
                {/* SVG overlay: connector line per pair, colored per (cellA, cellB) */}
                {currentPairBets.length > 0 && gridSize.w > 0 && gridSize.h > 0 && (() => {
                  const GAP = 6  // must match gap-1.5 (0.375rem = 6px)
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
                  const isWinner = winnerHighlight && diceResults.includes(symbol) && !isRolling
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
                    borderColor = '#facc15'; borderWidth = 3  // yellow = pair
                    glow = '0 0 14px rgba(250,204,21,0.5)'
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
                                ? 'rgba(250,204,21,0.15)'
                                : hasSingle
                                  ? 'rgba(252,165,165,0.3)'
                                  : '#ffffff',
                        boxShadow: glow,
                        cursor: isRolling ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div className="relative w-full h-full p-1">
                        <img
                          src={`/symbols/${symbol}.png`}
                          alt={SYMBOL_NAMES[symbol]}
                          loading="eager"
                          className="absolute inset-0 h-full w-full object-contain p-1 group-hover:scale-105 transition-transform"
                        />
                      </div>

                      {/* Dice value badge — top row puts it in the top-right
                          corner, bottom row puts it in the bottom-left, so it
                          never collides with the bet-amount badge on the
                          tile's "outside" corner. */}
                      <div
                        className={`absolute flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${idx < 4 ? 'top-1 right-1' : 'bottom-1 left-1'}`}
                        style={{ background: 'rgba(76,29,149,0.92)', color: '#fde68a', border: '1px solid #a78bfa' }}
                      >
                        {SYMBOL_VALUES[symbol]}
                      </div>

                      {bet > 0 && (
                        <div
                          className={`absolute flex h-7 min-w-[36px] items-center justify-center rounded-full px-2 font-bold shadow-lg text-[10px] whitespace-nowrap ${idx < 4 ? 'bottom-1.5 right-1.5' : 'top-1.5 right-1.5'}`}
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

              {/* Single + pair bets summary + hint */}
              <div className="mx-auto mt-2 flex flex-col items-center gap-1" style={{ maxWidth: 560 }}>
                {currentBets.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {currentBets.map(b => {
                      const won = !isRolling && diceResults.length > 0 && diceResults.includes(b.symbol)
                      return (
                        <div
                          key={`single-${b.cell}`}
                          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                          style={{
                            background: won ? 'rgba(250,204,21,0.25)' : '#1e0040',
                            border: `1px solid ${won ? '#facc15' : '#dc2626'}`,
                            color: won ? '#fde68a' : '#e9d5ff',
                          }}
                        >
                          <span className="inline-flex items-center gap-1">
                            <img src={`/symbols/${b.symbol}.png`} alt={b.symbol} className="h-3 w-3 rounded object-contain bg-white" />
                            <span>{SYMBOL_VALUES[b.symbol]}</span>
                          </span>
                          <span>{b.amount.toLocaleString()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
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
                          <span className="inline-flex items-center gap-1">
                            <img src={`/symbols/${p.a}.png`} alt={p.a} className="h-3 w-3 rounded object-contain bg-white" />
                            <span>{SYMBOL_VALUES[p.a]}</span>
                            <span className="px-0.5 opacity-70">+</span>
                            <img src={`/symbols/${p.b}.png`} alt={p.b} className="h-3 w-3 rounded object-contain bg-white" />
                            <span>{SYMBOL_VALUES[p.b]}</span>
                          </span>
                          <span style={{ color: won ? '#fde68a' : color }}>×{loaderData.payoutConfig.pair}</span>
                          <span>{p.amount.toLocaleString()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="text-[14px] text-center" style={{ color: '#c4b5fd' }}>
                  {t('game.tapAdjacent')}
                </div>
              </div>

              {/* Range/Sum betting — numbers 3-18 for LIVE, LOW/MID/HIGH for RANDOM */}
              {mode === 'live' ? (
                <div className="mx-auto mt-3" style={{ maxWidth: 560 }}>
                  <div className="mb-1 flex items-center justify-between text-[10px]" style={{ color: '#c4b5fd' }}>
                    <span>ເລືອກໄດ້ສູງສຸດ 3 ເລກ · ຈ່າຍ ×3 (<span style={{ color: '#fca5a5' }}>3,7,11,15 = ×5</span>)</span>
                    <span>{currentSumBets.length}/3</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {Array.from({ length: 16 }, (_, i) => i + 3).map(n => {
                      const bet = getSumBetAmount(n)
                      const isWinner = winnerHighlight && !isRolling && diceResults.length > 0 && diceSum === n
                      const isSelected = currentSumBets.some(b => b.sum === n)
                      const maxReached = currentSumBets.length >= 3 && !isSelected
                      const isSpecial = [3, 7, 11, 15].includes(n)
                      return (
                        <button
                          key={n}
                          onClick={() => placeSumBet(n)}
                          disabled={bettingLocked || balance < selectedChip || maxReached}
                          className="relative flex flex-col items-center justify-center rounded py-1 transition-all disabled:opacity-40"
                          style={{
                            background: isWinner ? 'rgba(250,204,21,0.35)' : isSelected ? 'rgba(124,58,237,0.5)' : isSpecial ? 'rgba(185,28,28,0.85)' : 'rgba(30,0,64,0.7)',
                            border: `1px solid ${isWinner ? '#facc15' : isSelected ? '#a78bfa' : isSpecial ? '#ef4444' : '#4c1d95'}`,
                            boxShadow: isWinner ? '0 0 16px rgba(250,204,21,0.55)' : isSelected ? '0 0 10px rgba(167,139,250,0.4)' : isSpecial ? '0 0 6px rgba(239,68,68,0.4)' : 'none',
                            color: isWinner ? '#facc15' : '#fff',
                          }}
                        >
                          <div className="text-xs font-bold">{n}</div>
                          <div className="text-[8px] opacity-70">{isSpecial ? '×5' : '×3'}</div>
                          {bet > 0 && (
                            <div className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[28px] items-center justify-center rounded-full px-1 font-bold text-[8px] whitespace-nowrap"
                              style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', color: '#fff', border: '1px solid #fca5a5' }}>
                              {bet.toLocaleString()}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div data-tour="range-bets" className="mx-auto mt-3 grid grid-cols-3 gap-2" style={{ maxWidth: 560 }}>
                  {RANGE_CONFIG.map(r => {
                    const bet = getRangeBetAmount(r.key)
                    const isWinner = winnerHighlight && !isRolling && diceResults.length > 0 && diceSum >= r.min && diceSum <= r.max
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
                        <div className="text-sm font-semibold ">
                          {r.key === 'low' ? t('game.low') : r.key === 'middle' ? t('game.middle') : t('game.high')}{' '}
                          <span className="text-xs opacity-90">({r.range})</span>
                        </div>
                        <div className="text-[10px] opacity-75">{t('game.pays', { x: rangeMultiplier(r.key, loaderData.payoutConfig) - 1 })}</div>
                        {bet > 0 && (
                          <div
                            className="absolute top-1.5 right-1.5 flex h-7 min-w-[36px] items-center justify-center rounded-full px-2 font-bold shadow-lg text-[10px] whitespace-nowrap"
                            style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)', color: '#fff', border: '1px solid #fca5a5' }}
                          >
                            {bet.toLocaleString()}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>)}
          </div>

          <div
            className={`flex flex-wrap items-center justify-between gap-4 px-4 py-6 pb-28 md:hidden ${mode === 'live' && livePhase !== 'betting' ? 'hidden' : ''}`}
            style={{ background: '#1e0040', borderTop: '1px solid #a78bfa' }}
          >
            {/* LEFT: chip / price input */}
            <div data-tour="chip-selector" className="flex items-center gap-1.5">
              {CHIP_CONFIG.map(chip => (
                <button
                  key={chip.value}
                  onClick={() => { soundEnabled && playCoin(); ensureBgMusic(); setSelectedChip(chip.value) }}
                  disabled={randomBoardLocked}
                  className={`relative flex h-12 w-12 flex-col items-center justify-center rounded-full bg-gradient-to-b ${chip.colors} font-bold text-white transition-all disabled:opacity-40`}
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
            </div>

            {/* RIGHT: UNDO button */}
            <button
              onClick={undoBet}
              disabled={bettingLocked || (!hasAnyBet && pendingCell === null)}
              className="rounded-xl px-5 py-2.5 text-sm font-bold  transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #f59e0b, #b45309)', color: '#1e0040', border: '1px solid #fcd34d' }}
            >
              {t('game.undo')}
            </button>
          </div>
        </div>

        {/* Floating action button on mobile (right aside is hidden < md). */}
        {mode === 'random' ? (
          isRolling ? (
            // 8s processing — countdown ring replaces the button
            <div className="fixed bottom-4 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full md:hidden"
              style={{ background: '#1e0040', border: '2px solid #facc15' }}>
              <ProcessingRing countdown={processingCountdown} size="sm" />
            </div>
          ) : isRoundOpen ? (
            // 15s betting window countdown
            <div className="fixed bottom-4 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full md:hidden"
              style={{ background: '#1e0040', border: '2px solid #facc15' }}>
              <BetCountdownRing countdown={betCountdown} size="sm" />
            </div>
          ) : !resultModal && !isRevealingResult ? (
            <button
              data-tour="bet-confirm"
              onClick={openRound}
              className="fixed bottom-4 right-4 z-40 flex h-14 items-center justify-center rounded-xl px-5 font-bold text-sm transition-all md:hidden"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff', border: '2px solid #14532d',
                boxShadow: '0 4px 20px rgba(22,163,74,0.6)',
              }}
            >
              {t('game.bet')}
            </button>
          ) : null
        ) : livePhase === 'betting' && (
          <button
            onClick={placeLiveBets}
            disabled={!hasAnyBet || playRoundFetcher.state !== 'idle'}
            className="fixed bottom-4 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full font-bold  text-xs transition-all disabled:opacity-40 md:hidden"
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
              { label: t('stats.lastBet'), value: lastBetTotal.toLocaleString(), color: '#fde68a' },
              { label: t('stats.lastWin'), value: lastWin.toLocaleString(), color: lastWin > 0 ? '#4ade80' : '#6d28d9' },
              { label: t('stats.curBet'), value: totalBet.toLocaleString(), color: '#fde68a' },
              { label: t('stats.balance'), value: balance.toLocaleString(), color: '#fde68a' },
            ].map((stat, i, arr) => (
              <div key={stat.label}>
                <div className="text-center">
                  <div className="text-[9px] font-bold  mb-0.5" style={{ color: '#c4b5fd' }}>{stat.label}</div>
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
              <div data-tour="chip-selector" className="grid w-full grid-cols-2 justify-items-center gap-2">
                {CHIP_CONFIG.map(chip => (
                  <button
                    key={chip.value}
                    onClick={() => { soundEnabled && playCoin(); ensureBgMusic(); setSelectedChip(chip.value) }}
                    disabled={randomBoardLocked}
                    className={`relative flex h-11 w-full items-center justify-center rounded-xl font-bold text-white transition-all disabled:opacity-40`}
                    style={{
                      border: selectedChip === chip.value ? "2px solid white" : `1px solid gray`,
                      boxShadow: selectedChip === chip.value ? `0 0 12px ${chip.border}` : '0 2px 6px rgba(0,0,0,0.5)',
                      fontSize: chip.value >= 100_000 ? 9 : 10,
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <button
                onClick={undoBet}
                disabled={bettingLocked || (!hasAnyBet && pendingCell === null)}
                className="flex items-center justify-center gap-2 bg-red-500 w-full rounded-xl p-3 text-xs font-bold  transition-opacity disabled:opacity-40 text-white"
              >
                <Undo size={14} />
                {t('game.undo')}
              </button>
            </div>
          )}

          <div className="mt-auto">
            {mode === 'random' ? (
              isRolling ? (
                // 8s processing — countdown ring (desktop)
                <div className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: '#1e0040', border: '4px solid #facc15' }}>
                  <ProcessingRing countdown={processingCountdown} size="lg" />
                </div>
              ) : isRoundOpen ? (
                // 15s betting window countdown ring (desktop)
                <div className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: '#1e0040', border: '4px solid #facc15' }}>
                  <BetCountdownRing countdown={betCountdown} size="lg" />
                </div>
              ) : !resultModal && !isRevealingResult ? (
                <button
                  data-tour="bet-confirm"
                  onClick={openRound}
                  className="flex w-full items-center justify-center rounded-xl px-4 py-4 font-bold text-sm transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff', border: '2px solid #f59e0b',
                    boxShadow: '0 0 22px rgba(22,163,74,0.55)',
                  }}
                >
                  {t('game.bet')}
                </button>
              ) : null
            ) : livePhase === 'betting' ? (
              <button
                onClick={placeLiveBets}
                disabled={!hasAnyBet || playRoundFetcher.state !== 'idle'}
                className="flex h-20 w-20 flex-col items-center justify-center rounded-full text-center font-bold  text-[10px] transition-all disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  border: '4px solid #f59e0b',
                  boxShadow: '0 0 22px rgba(22,163,74,0.55)',
                }}
                title="Place your bets in this round"
              >
                <span className="text-sm">ແທງເລີຍ</span>
                <span className="opacity-80">{liveTimer}s</span>
              </button>
            ) : (
              <div
                className="flex h-20 w-20 flex-col items-center justify-center rounded-full text-center font-bold  text-[9px]"
                style={{
                  background: 'linear-gradient(135deg, #b45309, #78350f)',
                  color: '#fde68a',
                  border: '4px solid #f59e0b',
                  boxShadow: '0 0 22px rgba(234,88,12,0.55)',
                }}
                title={t('live.waitingHostShort')}
              >
                <span>{t('game.waiting')}</span>
              </div>
            )}
          </div>
        </aside>
      </main>

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
              className="w-full max-w-sm rounded-md bg-white p-6 overflow-y-auto"
              style={{ maxHeight: '95vh' }}
            >
              <div className="text-center text-xs font-bold text-gray-500">
                {t('result.titleRandom')}
              </div>
              <div className="mt-2 text-center text-2xl font-bold" style={{ color: accent }}>
                {isWin ? t('result.youWin') : isEven ? t('result.breakEven') : t('result.youLost')}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                {resultModal.dice.map((s, i) => (
                  <img key={i} src={`/symbols/${s}.png`} alt={s}
                    className="h-12 w-12 rounded object-contain"
                    style={{ border: '1px solid #c4b5fd', background: '#f5f5f5' }} />
                ))}
                <span className="ml-2 rounded-full px-3 py-1 text-xs font-bold" style={{ background: '#f3f4f6', color: '#1e0040' }}>
                  {t('result.sum')} {resultModal.diceSum}
                </span>
              </div>
              <div className="mt-4 text-center text-4xl font-bold" style={{ color: accent }}>
                {isEven ? '0' : (isWin ? '+' : '−')}
                {!isEven && <CountUpNumber from={0} to={Math.abs(net)} duration={1400} sound />}
              </div>
              <BetBreakdown
                symbolBets={symbolToBreakdown(resultModal.symbolResults)}
                rangeBets={rangeToBreakdown(resultModal.rangeResults, t)}
                pairBets={pairToBreakdown(resultModal.pairResults)}
              />
              <div className="mt-4 border-t border-gray-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{t('result.totalBalance')}</span>
                  <span className="text-xl font-bold">
                    <CountUpNumber
                      from={Math.max(0, resultModal.newBalance - net)}
                      to={resultModal.newBalance}
                      duration={1600}
                    />
                  </span>
                </div>
                <button
                  onClick={() => setResultModal(null)}
                  className="mt-4 w-full rounded-xl py-3 text-sm font-bold transition-opacity hover:opacity-90 border"
                  autoFocus
                >
                  {t('result.continue')}
                </button>
              </div>
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
              className="w-full max-w-sm rounded-md bg-white p-6 overflow-y-auto"
              style={{ maxHeight: '95vh' }}
            >
              <div className="text-center text-xs font-bold text-gray-500">{t('result.titleLive')}</div>
              <div className="mt-2 text-center text-2xl font-bold" style={{ color: accent }}>
                {isWin ? t('result.youWin') : isEven ? t('result.breakEven') : t('result.youLost')}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                {m.dice.map((s, i) => (
                  <img key={i} src={`/symbols/${s.toLowerCase()}.png`} alt={s}
                    className="h-12 w-12 rounded object-contain"
                    style={{ border: '1px solid #c4b5fd', background: '#f5f5f5' }} />
                ))}
                <span className="ml-2 rounded-full px-3 py-1 text-xs font-bold" style={{ background: '#f3f4f6', color: '#1e0040' }}>
                  {t('result.sum')} {m.diceSum}
                </span>
              </div>
              <div className="mt-4 text-center text-4xl font-bold" style={{ color: accent }}>
                {amountText}
              </div>
              {m.bets.length > 0 && (() => {
                const split = settledToBreakdown(m.bets, t)
                return (
                  <BetBreakdown
                    symbolBets={split.symbolBets}
                    rangeBets={split.rangeBets}
                    pairBets={split.pairBets}
                    sumBets={split.sumBets}
                  />
                )
              })()}
              <div className="mt-4 border-t border-gray-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{t('result.totalBalance')}</span>
                  <span className="text-xl font-bold">{m.newBalance.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => setLiveSettleModal(null)}
                  className="mt-4 w-full rounded-xl py-3 text-sm font-bold transition-opacity hover:opacity-90 border"
                  autoFocus
                >
                  {t('result.continue')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Win-streak / promotion reward modal */}
      {rewardModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ background: 'rgba(10,0,20,0.88)' }}
          onClick={() => setRewardModal(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl p-6 text-center"
            style={{
              background: 'linear-gradient(160deg, #1a0a00 0%, #0f1a00 100%)',
              border: '2px solid #f59e0b',
              boxShadow: '0 0 40px rgba(245,158,11,0.35)',
            }}
          >
            <div className="text-5xl mb-3">🎁</div>
            <div className="text-xl font-bold" style={{ color: '#fbbf24' }}>ຂອງຂວັນພິເສດ!</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: '#fde68a' }}>{rewardModal.note}</div>
            <div className="mt-5 text-5xl font-bold" style={{ color: '#4ade80' }}>
              +{rewardModal.amount.toLocaleString()} ₭
            </div>
            <div className="mt-3 text-xs" style={{ color: '#94a3b8' }}>
              ຍອດເງິນ REAL: {rewardModal.newBalance.toLocaleString()} ₭
            </div>
            <button
              onClick={() => setRewardModal(null)}
              className="mt-6 w-full rounded-xl py-3 text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000' }}
            >
              ຂອບໃຈ! 🎉
            </button>
          </div>
        </div>
      )}

      <JoinGroupModal open={joinGroupOpen} onClose={() => setJoinGroupOpen(false)} />

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

      <FeatureTour
        steps={TOUR_STEPS}
        open={tourOpen}
        onClose={() => endTour(false)}
        onFinish={() => endTour(true)}
      />
    </div>
  )
}

// ─── Awaiting-result UI helpers (LIVE mode) ─────────────────────────────────

const SYMBOL_VALUE_BY_KEY: Record<SymbolKey, number> = {
  prawn: 1, fish: 2, crab: 3, rooster: 4, frog: 5, gourd: 6,
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
            <img src={`/symbols/${sym}.png`} alt={sym} className="absolute inset-0 h-full w-full object-contain p-1" />
          ) : (
            <span style={{ color: '#7c3aed', fontSize: 26 }}>?</span>
          )}
        </div>
      ))}
    </div>
  )
}

type Translate = ReturnType<typeof useT>

// Translated range label, e.g. RANGE 'LOW' → 'ຕໍ່າ (3-8)' / 'LOW (3-8)'.
function translatedRangeLabel(range: string, t: Translate): string {
  const cfg = RANGE_LABELS[range]
  if (!cfg) return range
  const label = range === 'LOW' ? t('game.low') : range === 'MIDDLE' ? t('game.middle') : t('game.high')
  return `${label} (${cfg.range})`
}

// Text-only formatter used in spots that can't render JSX (e.g. tooltips,
// the awaiting-result MyBetsList). Pass `t` so range labels translate.
function describeBetGeneric(
  b: { kind: string; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; exactSum?: number | null },
  t: Translate,
): string {
  if (b.kind === 'SYMBOL' && b.symbol) {
    const k = b.symbol.toLowerCase() as SymbolKey
    return `${symName(b.symbol, t)} (${SYMBOL_VALUE_BY_KEY[k]})`
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    const a = b.pairA.toLowerCase() as SymbolKey
    const c = b.pairB.toLowerCase() as SymbolKey
    return `${symName(b.pairA, t)} (${SYMBOL_VALUE_BY_KEY[a]}) + ${symName(b.pairB, t)} (${SYMBOL_VALUE_BY_KEY[c]})`
  }
  if (b.kind === 'RANGE' && b.range) {
    return translatedRangeLabel(b.range, t)
  }
  if (b.kind === 'SUM' && b.exactSum != null) {
    return `ເລກ ${b.exactSum}`
  }
  return b.kind
}

// JSX label used inside the BetBreakdown rows. Single + Pair render as small
// symbol icons (no text); Range renders as a translated text pill.
function symbolIcon(symbol: SymbolKey | string) {
  const key = symbol.toLowerCase()
  return (
    <img
      src={`/symbols/${key}.png`}
      alt={key}
      className="h-6 w-6 rounded object-contain"
      style={{ border: '1px solid #d4d4d8', background: '#fff' }}
    />
  )
}

// JSX renderer for a single bet — shows symbol/pair icons + translated names,
// and a colored arrow icon for range bets.
function describeBetIcon(b: MyLiveBet, t: Translate) {
  if (b.kind === 'SYMBOL' && b.symbol) {
    const k = b.symbol.toLowerCase() as SymbolKey
    return (
      <span className="flex items-center gap-2 truncate">
        <img src={`/symbols/${k}.png`} alt="" className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
        <span className="truncate">{symName(b.symbol, t)} ({SYMBOL_VALUE_BY_KEY[k]})</span>
      </span>
    )
  }
  if (b.kind === 'PAIR' && b.pairA && b.pairB) {
    const a = b.pairA.toLowerCase() as SymbolKey
    const c = b.pairB.toLowerCase() as SymbolKey
    return (
      <span className="flex items-center gap-1.5 truncate">
        <img src={`/symbols/${a}.png`} alt="" className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
        <span className="shrink-0">{symName(b.pairA, t)} ({SYMBOL_VALUE_BY_KEY[a]})</span>
        <span className="shrink-0">+</span>
        <img src={`/symbols/${c}.png`} alt="" className="h-5 w-5 shrink-0 rounded object-contain" style={{ background: '#fff' }} />
        <span className="shrink-0">{symName(b.pairB, t)} ({SYMBOL_VALUE_BY_KEY[c]})</span>
      </span>
    )
  }
  if (b.kind === 'RANGE' && b.range) {
    const Icon = b.range === 'LOW' ? ArrowDown : b.range === 'HIGH' ? ArrowUp : ArrowUpDown
    const color = b.range === 'LOW' ? '#4ade80' : b.range === 'HIGH' ? '#f87171' : '#fbbf24'
    return (
      <span className="flex items-center gap-2 truncate">
        <Icon size={16} style={{ color }} className="shrink-0" />
        <span className="truncate">{translatedRangeLabel(b.range, t)}</span>
      </span>
    )
  }
  if (b.kind === 'SUM' && b.exactSum != null) {
    return (
      <span className="flex items-center gap-2 truncate">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold text-xs"
          style={{ background: '#7c3aed', color: '#fde68a' }}>{b.exactSum}</span>
        <span className="truncate">ເລກ {b.exactSum}</span>
      </span>
    )
  }
  return <span>{t('bet.symbol')}</span>
}

function MyBetsList({ bets, glass = false }: { bets: MyLiveBet[]; glass?: boolean }) {
  const t = useT()
  const total = bets.reduce((s, b) => s + b.amount, 0)
  return (
    <div
      className="w-full max-w-sm rounded-xl p-4"
      style={glass
        ? { background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.08)' }
        : { background: '#1e0040', border: '1px solid #4c1d95' }}
    >
      <div className="mb-2 text-[10px] font-bold" style={{ color: glass ? '#e9d5ff' : '#a78bfa' }}>
        {t('result.yourBetsThisRound')}
      </div>
      <ul className="flex flex-col gap-1">
        {bets.map(b => (
          <li
            key={b.id}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
            style={{ background: glass ? 'rgba(255,255,255,0.05)' : '#2d1b4e', color: '#e9d5ff' }}
          >
            {describeBetIcon(b, t)}
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
        <span>{t('result.total')}</span>
        <span>{total.toLocaleString()} ₭</span>
      </div>
    </div>
  )
}

// Shared per-bet breakdown rendered inside the RANDOM and LIVE result modals.
// Each section only renders when there are bets of that kind.
type BreakdownBet = {
  label: React.ReactNode  // either translated text (range) or a small icon (single/pair)
  amount: number   // stake
  payout: number   // 0 if lost; gross-payout including stake if won; stake if refunded
  won: boolean
  refunded?: boolean  // voided locked high-value bet — stake returned, no win/loss
}
type BetBreakdownProps = {
  symbolBets: BreakdownBet[]
  rangeBets: BreakdownBet[]
  pairBets: BreakdownBet[]
  sumBets?: BreakdownBet[]
}

function BetBreakdown({ symbolBets, rangeBets, pairBets, sumBets = [] }: BetBreakdownProps) {
  const t = useT()
  const sections: { title: string; bets: BreakdownBet[] }[] = [
    { title: t('result.singleBets'), bets: symbolBets },
    { title: t('result.rangeBets'), bets: rangeBets },
    { title: t('result.pairBets'), bets: pairBets },
    { title: 'ເດີມພັນຕົວເລກ', bets: sumBets },
  ].filter(s => s.bets.length > 0)

  const allBets = [...symbolBets, ...rangeBets, ...pairBets, ...sumBets]
  const totalStake = allBets.reduce((s, b) => s + b.amount, 0)
  // Profit on winning bets only — matches the +/- amount shown per row.
  const totalWon = allBets.filter(b => b.won).reduce((s, b) => s + (b.payout - b.amount), 0)
  const totalLost = allBets.filter(b => !b.won && !b.refunded).reduce((s, b) => s + b.amount, 0)
  const hasRefund = allBets.some(b => b.refunded)

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* Explain to the customer why a bet was refunded (locked high-value void). */}
      {hasRefund && (
        <div className="rounded-md px-3 py-2 text-[11px] font-semibold"
          style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309', border: '1px solid #f59e0b' }}>
          {t('result.refundNote')}
        </div>
      )}
      {sections.map(s => (
        <div key={s.title} className="rounded-md px-3 py-2" style={{ background: '#f3f4f6' }}>
          <div className="mb-1.5 text-[10px] font-bold  text-gray-500">{s.title}</div>
          <ul className="flex flex-col overflow-hidden rounded">
            {s.bets.map((b, i) => {
              const color = b.refunded ? '#d97706' : b.won ? '#16a34a' : '#dc2626'
              const sign = b.refunded ? '' : b.won ? '+' : '-'
              const amount = b.refunded ? b.amount : b.won ? b.payout - b.amount : b.amount
              return (
                <li
                  key={i}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 text-[11px]"
                  style={{
                    background: '#fff',
                    borderBottom: i < s.bets.length - 1 ? '1px solid #e5e7eb' : 'none',
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-gray-700">
                    <span className="inline-flex items-center">{b.label}</span>
                    <span className="truncate">· {b.amount.toLocaleString()}</span>
                  </span>
                  <span className="text-[10px] font-bold " style={{ color }}>
                    {b.refunded ? t('history.refunded') : b.won ? t('result.win') : t('result.loss')}
                  </span>
                  <span className="text-right font-bold" style={{ color }}>
                    {sign}{amount.toLocaleString()}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {/* Totals card — always rendered so the customer sees the round shape
          even when only one section has bets. */}
      <div className="rounded-md px-3 py-2 text-[11px]" style={{ background: '#f3f4f6' }}>
        <div className="flex items-center justify-between">
          <span className="font-bold  text-gray-600">{t('result.totalStake')}</span>
          <span className="font-bold" style={{ color: '#1e0040' }}>{totalStake.toLocaleString()}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-bold  text-gray-600">{t('result.totalWon')}</span>
          <span className="font-bold" style={{ color: '#16a34a' }}>+{totalWon.toLocaleString()}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-bold  text-gray-600">{t('result.totalLost')}</span>
          <span className="font-bold" style={{ color: '#dc2626' }}>-{totalLost.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

// Renders the small symbol-pair label: "[A] + [B]" using two icons.
function pairIcons(a: SymbolKey | string, b: SymbolKey | string) {
  return (
    <span className="inline-flex items-center gap-1">
      {symbolIcon(a)}
      <span className="px-0.5 text-gray-500">+</span>
      {symbolIcon(b)}
    </span>
  )
}

// Helpers that convert each result-list shape into the BreakdownBet[] form
// the BetBreakdown component expects. Single + Pair render as small symbol
// icons; Range renders as a translated text pill.
function symbolToBreakdown(
  bets: { symbol: SymbolKey; amount: number; payout: number; won: boolean }[],
): BreakdownBet[] {
  return bets.map(b => ({
    label: symbolIcon(b.symbol),
    amount: b.amount, payout: b.payout, won: b.won,
  }))
}
function rangeToBreakdown(
  bets: { range: RangeKey; amount: number; payout: number; won: boolean }[],
  t: Translate,
): BreakdownBet[] {
  return bets.map(b => ({
    label: translatedRangeLabel(b.range.toUpperCase(), t),
    amount: b.amount, payout: b.payout, won: b.won,
  }))
}
function pairToBreakdown(
  bets: { a: SymbolKey; b: SymbolKey; amount: number; payout: number; won: boolean }[],
): BreakdownBet[] {
  return bets.map(b => ({
    label: pairIcons(b.a, b.b),
    amount: b.amount, payout: b.payout, won: b.won,
  }))
}

// Settlement-payload shape (LIVE modal) → BreakdownBet[] sections.
function settledToBreakdown(
  bets: { kind: 'SYMBOL' | 'RANGE' | 'PAIR' | 'SUM'; amount: number; symbol: string | null; range: string | null; pairA: string | null; pairB: string | null; exactSum?: number | null; payout: number; result: 'WIN' | 'LOSS' | 'REFUNDED' }[],
  t: Translate,
): { symbolBets: BreakdownBet[]; rangeBets: BreakdownBet[]; pairBets: BreakdownBet[]; sumBets: BreakdownBet[] } {
  const out = { symbolBets: [] as BreakdownBet[], rangeBets: [] as BreakdownBet[], pairBets: [] as BreakdownBet[], sumBets: [] as BreakdownBet[] }
  for (const b of bets) {
    let label: React.ReactNode
    if (b.kind === 'SYMBOL' && b.symbol) label = symbolIcon(b.symbol)
    else if (b.kind === 'PAIR' && b.pairA && b.pairB) label = pairIcons(b.pairA, b.pairB)
    else if (b.kind === 'RANGE' && b.range) label = translatedRangeLabel(b.range, t)
    else if (b.kind === 'SUM' && b.exactSum != null) label = `ເລກ ${b.exactSum}`
    else label = b.kind
    const entry: BreakdownBet = { label, amount: b.amount, payout: b.payout, won: b.result === 'WIN', refunded: b.result === 'REFUNDED' }
    if (b.kind === 'SYMBOL') out.symbolBets.push(entry)
    else if (b.kind === 'RANGE') out.rangeBets.push(entry)
    else if (b.kind === 'PAIR') out.pairBets.push(entry)
    else if (b.kind === 'SUM') out.sumBets.push(entry)
  }
  return out
}
