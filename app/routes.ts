import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("logout", "routes/logout.tsx"),
  route("history", "routes/history.tsx"),
  route("profile", "routes/profile.tsx"),
  route("wallet", "routes/wallet.tsx"),
  route("rules", "routes/rules.tsx"),
  route("competition", "routes/competition.tsx"),
  route("api/avatar", "routes/api.avatar.tsx"),
  route("api/payment-slip", "routes/api.payment-slip.tsx"),
  route("api/play-round", "routes/api.play-round.tsx"),
  route("api/pick-dice", "routes/api.pick-dice.tsx"),
  route("api/save-round", "routes/api.save-round.tsx"),
  route("api/warm", "routes/api.warm.tsx"),
  route("api/bank-qr", "routes/api.bank-qr.tsx"),
  route("api/locale", "routes/api.locale.tsx"),
  route("api/lookup-tel", "routes/api.lookup-tel.tsx"),
  route("api/pusher-auth", "routes/api.pusher-auth.tsx"),
  route("api/cancel-live-bet", "routes/api.cancel-live-bet.tsx"),
  route("api/reset-demo", "routes/api.reset-demo.tsx"),
  route("api/mark-tour-seen", "routes/api.mark-tour-seen.tsx"),
  route("api/admin/live-history", "routes/api.admin.live-history.tsx"),
  route("api/admin/wallet-summary", "routes/api.admin.wallet-summary.tsx"),
  route("api/admin/viewer-balances", "routes/api.admin.viewer-balances.tsx"),

  // Admin auth (outside the admin layout — login can't require admin).
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/logout", "routes/admin.logout.tsx"),

  // Admin dashboard — `admin.tsx` is the layout (sidebar + Outlet, requireAdmin).
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("customers", "routes/admin.customers.tsx"),
    route("wallet", "routes/admin.wallet.tsx"),
    route("transactions", "routes/admin.transactions.tsx"),
    route("play-history", "routes/admin.play-history.tsx"),
    route("live", "routes/admin.live.tsx"),
    route("competition", "routes/admin.competition.tsx"),
    route("competition/:id", "routes/admin.competition.$id.tsx"),
    route("financial", "routes/admin.financial.tsx"),
  ]),
] satisfies RouteConfig
