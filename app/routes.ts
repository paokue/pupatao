import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("logout", "routes/logout.tsx"),
  route("history", "routes/history.tsx"),
  route("profile", "routes/profile.tsx"),
  route("wallet", "routes/wallet.tsx"),
  route("api/avatar", "routes/api.avatar.tsx"),
  route("api/payment-slip", "routes/api.payment-slip.tsx"),
  route("api/play-round", "routes/api.play-round.tsx"),
  route("api/bank-qr", "routes/api.bank-qr.tsx"),
  route("api/locale", "routes/api.locale.tsx"),
  route("api/lookup-tel", "routes/api.lookup-tel.tsx"),
  route("api/pusher-auth", "routes/api.pusher-auth.tsx"),

  // Admin auth (outside the admin layout — login can't require admin).
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/logout", "routes/admin.logout.tsx"),

  // Admin dashboard — `admin.tsx` is the layout (sidebar + Outlet, requireAdmin).
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("customers", "routes/admin.customers.tsx"),
    route("transactions", "routes/admin.transactions.tsx"),
    route("play-history", "routes/admin.play-history.tsx"),
    route("live", "routes/admin.live.tsx"),
  ]),
] satisfies RouteConfig
