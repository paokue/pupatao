import { useState } from "react"
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
