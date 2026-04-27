import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["icon.svg", "apple-icon.png", "icon-dark-32x32.png", "icon-light-32x32.png", "symbols/*.jpg"],
      manifest: {
        name: "Fish Prawn Crab Game",
        short_name: "Pupatao",
        description: "Traditional Asian dice betting game",
        theme_color: "#1e0040",
        background_color: "#3b0764",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // Precache static assets only — never HTML. HTML is server-rendered
        // per-request with the auth user baked in (root loader), so caching
        // it would replay a stale "anonymous" page on refresh and silently
        // log the user out from the UI's perspective.
        globPatterns: ["**/*.{js,css,svg,png,jpg,ico,webmanifest}"],
        // No navigateFallback — let every navigation hit the network so the
        // SSR payload (user, wallet) is always fresh.
      },
      // SW disabled in dev. Re-enable later only after we have a strategy
      // that doesn't cache authed HTML.
      devOptions: { enabled: false },
    }),
  ],
  ssr: { external: ['@prisma/client', '.prisma/client', 'bcryptjs', 'pusher'] },
})
