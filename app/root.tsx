import { useEffect, useState } from "react"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router"
import { Toaster } from "sonner"
import { Trophy, X } from "lucide-react"
import type { Route } from "./+types/root"
import { DEFAULT_LOCALE, parseLocaleCookie, type Locale } from "./lib/i18n"
import { GlobalNavLoader } from "./components/GlobalNavLoader"
import "./app.css"

// Serialized shape of the authed user that's safe to pass to the browser.
// Defined here (not re-exported from auth.server.ts) so client-side imports
// of this type never pull Prisma/bcrypt into the browser bundle.
export type SessionUser = {
  id: string
  tel: string
  firstName: string | null
  lastName: string | null
  profile: string | null
  role: 'PLAYER' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'
} | null

// DB-backed wallet balances. Null when the visitor is anonymous.
export type SessionWallets = {
  demo: number
  real: number
  promo: number
} | null

export async function loader({ request }: Route.LoaderArgs) {
  const locale: Locale = parseLocaleCookie(request.headers.get('cookie'))

  // Lazy-import so Vite doesn't eagerly pull Prisma into client module graph.
  const { getCurrentUser } = await import("./lib/auth.server")
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser(request)
  } catch (err) {
    // DB hiccup — render the page as anonymous rather than throwing the whole
    // root loader, which would otherwise drop the user into an error boundary
    // on every refresh.
    console.error('[root loader] getCurrentUser failed:', err)
  }

  let wallets: SessionWallets = null
  if (user) {
    // Wrapped so a transient DB hiccup doesn't blow up the root loader on
    // every page (which would otherwise look like the user got logged out
    // because the error boundary takes over until they re-navigate).
    try {
      const { prisma } = await import("./lib/prisma.server")
      const ws = await prisma.wallet.findMany({
        where: { userId: user.id },
        select: { type: true, balance: true },
      })
      wallets = {
        demo: ws.find(w => w.type === 'DEMO')?.balance ?? 0,
        real: ws.find(w => w.type === 'REAL')?.balance ?? 0,
        promo: ws.find(w => w.type === 'PROMO')?.balance ?? 0,
      }
    } catch (err) {
      console.error('[root loader] wallet fetch failed:', err)
      // Leave `wallets` null — page still renders, balances stay at the last
      // value the in-browser store knows about.
    }
  }

  const sessionUser: SessionUser = user
    ? {
      id: user.id,
      tel: user.tel,
      firstName: user.firstName,
      lastName: user.lastName,
      profile: user.profile,
      role: user.role,
    }
    : null
  const { getCompetitionConfig } = await import('./lib/system-settings.server')
  const competition = await getCompetitionConfig()

  return {
    user: sessionUser, wallets, locale,
    competitionEnabled: competition.enabled,    // for banner (only show while running)
    competitionMenuVisible: competition.menuVisible, // for menu item visibility
  }
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-icon.png", sizes: "180x180" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap",
  },
]

export const meta: Route.MetaFunction = () => [
  { title: "Fish Prawn Crab Game" },
  { name: "description", content: "Traditional Asian dice betting game" },
  { name: "theme-color", content: "#1e0040" },
  { name: "mobile-web-app-capable", content: "yes" },
  { name: "apple-mobile-web-app-capable", content: "yes" },
  { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
  { name: "apple-mobile-web-app-title", content: "Pupatao" },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root')
  const lang: Locale = data?.locale ?? DEFAULT_LOCALE
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="font-sans antialiased">
        <GlobalNavLoader />
        {children}
        <Toaster
          position="bottom-center"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              success:
                '!bg-gradient-to-br !from-green-600 !to-green-800 !text-white !border-green-400',
            },
          }}
        />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App({ loaderData }: Route.ComponentProps) {
  // Descendant routes read these via `useOutletContext<{ user, wallets, locale }>()`.
  return (
    <>
      {loaderData.user && loaderData.competitionEnabled && (
        <CompetitionBanner />
      )}
      <PWAInstallPrompt />
      <Outlet
        context={{
          user: loaderData.user,
          wallets: loaderData.wallets,
          locale: loaderData.locale,
        }}
      />
    </>
  )
}

// Promo banner shown every time the user logs in while competition is active.
// This component mounts fresh on each login (parent conditionally renders it when
// user+competitionEnabled are both truthy) so useState(true) means "show on mount".
// Dismissal is in-memory only — no storage — so it reappears after every login.
function CompetitionBanner() {
  const [visible, setVisible] = useState(true)

  function dismiss() {
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[300] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
      style={{
        background: 'linear-gradient(135deg,#1e0040,#3b0764)',
        border: '2px solid #fbbf24',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(251,191,36,0.25)',
      }}>
      <div className="flex items-start gap-3 p-4">
        <span className="text-2xl shrink-0">🏆</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold" style={{ color: '#fbbf24' }}>ການແຂ່ງຂັນ Demo!</div>
          <div className="mt-0.5 text-xs" style={{ color: '#c4b5fd' }}>
            ລະບົບມີການແຂ່ງຂັນ Demo Play ຢູ່ ຜູ້ທີ່ມີ Demo Balance ສູງສຸດຊະນະ!
          </div>
          <div className="mt-2 flex gap-2">
            <a href="/competition"
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ background: 'linear-gradient(135deg,#ca8a04,#78350f)', color: '#fff', border: '1px solid #fbbf24' }}>
              <Trophy size={10} className="mr-1 inline" />
              ເບິ່ງຄະແນນ
            </a>
            <button type="button" onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#a5b4fc', border: '1px solid #4c1d95' }}>
              ປິດ
            </button>
          </div>
        </div>
        <button type="button" onClick={dismiss}
          className="shrink-0 rounded-full p-0.5" style={{ color: '#818cf8' }}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

// PWA install prompt — shown once per week (localStorage) to users who haven't
// installed the app yet. Android gets the native browser prompt; iOS/iPhone
// gets a step-by-step instruction card (Safari doesn't support beforeinstallprompt).
function PWAInstallPrompt() {
  const [show, setShow] = useState(false)
  const [isIos, setIsIos] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already installed as PWA (standalone mode) — never prompt
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true
    if (isStandalone) return

    // Dismissed earlier in this browser session — don't re-show until next visit
    try {
      if (sessionStorage.getItem('pwa_prompt_dismissed') === '1') return
    } catch { /* sessionStorage unavailable */ }

    const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent) &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !(window as any).MSStream
    setIsIos(ios)

    if (ios) {
      // iOS Safari doesn't fire beforeinstallprompt — show instructions after delay
      const t = setTimeout(() => setShow(true), 5000)
      return () => clearTimeout(t)
    }

    // Android / Chrome — beforeinstallprompt fires early (before React hydrates),
    // so entry.client.tsx captures it globally. Check that first; fall back to
    // a live listener in case it hasn't fired yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captured = (window as any).__pwaInstallPrompt
    if (captured) {
      setDeferredPrompt(captured)
      setTimeout(() => setShow(true), 3000)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setTimeout(() => setShow(true), 3000)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    // Suppress for this browser session only — shows again on next visit
    try { sessionStorage.setItem('pwa_prompt_dismissed', '1') } catch { /* ignore */ }
    setShow(false)
  }

  async function installAndroid() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShow(false)
    // Whether accepted or not, suppress for this session
    try { sessionStorage.setItem('pwa_prompt_dismissed', '1') } catch { /* ignore */ }
  }

  if (!show) return null

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[400] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
      style={{ filter: 'drop-shadow(0 8px 32px rgba(124,58,237,0.4))' }}
    >
      <div
        className="rounded-2xl p-5"
        style={{ background: 'linear-gradient(135deg,#1e0040,#2d1b4e)', border: '2px solid #7c3aed' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 28 }}>📲</span>
            <div>
              <div className="text-sm font-bold" style={{ color: '#fde68a' }}>ຕິດຕັ້ງແອັບ Pupatao</div>
              <div className="text-[10px]" style={{ color: '#a78bfa' }}>
                {isIos ? 'ສຳລັບ iPhone / iPad' : 'ໃຊ້ງານໄດ້ດີຂຶ້ນຄືແອັບ'}
              </div>
            </div>
          </div>
          <button type="button" onClick={dismiss}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#818cf8' }}>
            <X size={14} />
          </button>
        </div>

        {isIos ? (
          /* iOS: step-by-step instructions (Safari has no install API) */
          <>
            <p className="mb-3 text-xs" style={{ color: '#c4b5fd' }}>
              Safari ໃນ iPhone ສາມາດຕິດຕັ້ງໄດ້ດ້ວຍຂັ້ນຕອນດັ່ງນີ້:
            </p>
            <ol className="flex flex-col gap-2">
              {[
                { step: '1', icon: '⬆️', text: 'ກົດປຸ່ມ Share (ຮູບສີ່ລ່ຽມ + ລູກສອນ) ຢູ່ລຸ່ມໜ້າຈໍ' },
                { step: '2', icon: '➕', text: 'ເລື່ອນລົງ ແລ້ວກົດ "Add to Home Screen"' },
                { step: '3', icon: '✅', text: 'ກົດ "Add" ມູມຂວາເທິງ' },
              ].map(({ step, icon, text }) => (
                <li key={step} className="flex items-start gap-2 rounded-lg px-3 py-2"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid #4c1d95' }}>
                  <span className="shrink-0 text-sm">{icon}</span>
                  <span className="text-xs" style={{ color: '#e9d5ff' }}>{text}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={dismiss}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'linear-gradient(135deg,#4c1d95,#2d1b4e)', color: '#e9d5ff', border: '1px solid #7c3aed' }}>
              ເຂົ້າໃຈແລ້ວ
            </button>
          </>
        ) : (
          /* Android / Chrome: trigger native install prompt */
          <>
            <p className="mb-4 text-xs" style={{ color: '#c4b5fd' }}>
              ຕິດຕັ້ງ Pupatao ໃສ່ໜ້າຈໍຫຼັກ — ໄວ, ສະດວກ, ໃຊ້ໄດ້ຄືແອັບ!
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={dismiss}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#a78bfa', border: '1px solid #4c1d95' }}>
                ບໍ່ດຽວນີ້
              </button>
              <button type="button" onClick={installAndroid}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4c1d95)', color: '#fff', border: '1px solid #a78bfa' }}>
                ຕິດຕັ້ງເລີຍ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."

  if (error && typeof error === "object" && "status" in error) {
    const err = error as { status: number; statusText?: string; data?: string }
    message = err.status === 404 ? "404" : "Error"
    details = err.status === 404 ? "The requested page could not be found." : err.statusText || details
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-bold">{message}</h1>
      <p className="text-sm opacity-80">{details}</p>
    </main>
  )
}
