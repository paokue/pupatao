import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router"
import { Toaster } from "sonner"
import type { Route } from "./+types/root"
import { DEFAULT_LOCALE, parseLocaleCookie, type Locale } from "./lib/i18n"
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
  return { user: sessionUser, wallets, locale }
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/icon-light-32x32.png", media: "(prefers-color-scheme: light)" },
  { rel: "icon", href: "/icon-dark-32x32.png", media: "(prefers-color-scheme: dark)" },
  { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-icon.png" },
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
    <Outlet
      context={{
        user: loaderData.user,
        wallets: loaderData.wallets,
        locale: loaderData.locale,
      }}
    />
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
