# Pupatao — Fish Prawn Crab

Traditional Asian dice betting game (ບ່ອນບາງ / 鱼虾蟹). Built as a Progressive Web App.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **React Router v7** (framework mode, SSR) |
| Runtime | **Bun** |
| Bundler | Vite 6 |
| Styling | Tailwind v4 + Radix UI + shadcn/ui |
| Client state | React state + Zustand (persistent UI prefs) |
| PWA | `vite-plugin-pwa` (auto-update SW, Workbox precache) |
| Database | **MongoDB Atlas** |
| ORM | **Prisma v6** (v7 dropped direct Mongo support — keep on v6) |
| Auth | Phone + password (customers) · email + password (admins) |

## Project layout

```
app/
  root.tsx                  # HTML shell + root loader (reads current session)
  routes.ts                 # RRV7 route config
  app.css                   # Tailwind entry + theme tokens
  entry.client.tsx          # hydration + SW registration
  routes/
    home.tsx                # game board (RANDOM + LIVE modes) — public
    login.tsx               # phone + password sign-in (public)
    register.tsx            # phone + password sign-up (public)
    logout.tsx              # POST → revoke session + clear cookie
    wallet.tsx              # deposit/withdraw/transfer tabs (auth-only)
    history.tsx             # per-game play history (auth-only)
    profile.tsx             # user profile settings (auth-only)
  components/               # shadcn/ui primitives
  hooks/                    # useUser, useSoundEngine, …
  lib/
    prisma.server.ts        # shared PrismaClient singleton
    auth.server.ts          # session cookie + bcrypt helpers (requireUser, …)
    user-store.ts           # client-side wallet/game state (localStorage)
    ui-store.ts             # Zustand — balance hide/show
    utils.ts
prisma/
  schema.prisma             # data model (MongoDB)
  seed.ts                   # idempotent seed
public/
  symbols/*.jpg             # dice face images
  icon.svg, apple-icon.png  # PWA icons
```

## Game rules (short)

- **6 symbols** — each has a numeric value used for range bets:
  - prawn = 1 · crab = 2 · fish = 3 · rooster = 4 · frog = 5 · gourd = 6
- **Board** is 4 × 2. Gourd and prawn each appear twice (left & right cells).
- **Single bet** — tap a cell. Pays 2× / 3× / 4× for 1 / 2 / 3 matching dice.
- **Pair bet** — tap a cell, then tap an adjacent cell (orthogonal + diagonal).
  Pays **×6** if **both** symbols appear in the roll.
- **Range bet** — bet on the dice **sum**:
  - LOW (1-8) — pays **2×**
  - MIDDLE (9-10) — pays **4×**
  - HIGH (11-18) — pays **2×**
- Chip denominations: 5K · 10K · 20K · 100K · Custom (1 – 10,000,000 ₭).

## Modes

### Random mode
Self-play. You place bets, hit ROLL, dice are chosen randomly. Solo.

### Live mode (host + viewers)
- Host opens the betting window for 60 s.
- Players place bets while the timer runs.
- At 0 s the round locks.
- Host rolls physical dice on camera, then **enters the 3 symbols** in the admin panel.
- Payouts apply, round goes `idle`, host clicks "Start Round" to open a new one.
- **Stream**: currently an embedded YouTube iframe (placeholder: Lofi Girl). Swap `STREAM_URL` in `app/routes/home.tsx` for your channel. WebRTC / real multi-device sync is planned via the DB.
- **Admin panel stub**: append `?admin=1` to `/` to see host controls (Start Round + Enter Result) inline. Replace with a real `/admin` route once the backend is wired.

## Wallets

Every user gets **two** wallets on registration:

| Wallet | Behaviour |
|---|---|
| **DEMO** | Play-money for testing. Can be reset to 1,000,000 ₭ any time via the 🛠 +1M button. Cannot be deposited / withdrawn / transferred. |
| **REAL** | Real money. Deposit / Withdraw / Transfer via `/wallet`. **Never reset.** |

Toggle active wallet via the `🎮 DEMO` / `💵 REAL` pill in the game header.

## Transactions

| Type | Meaning |
|---|---|
| `DEPOSIT` | Credit, real wallet only |
| `WITHDRAW` | Debit, real wallet only |
| `TRANSFER_OUT` / `TRANSFER_IN` | Real wallet only. Stub validates `u_xxx` target id format; no recipient movement yet. |
| `WIN` / `LOSS` | Logged per round when dice resolve |
| `DEMO_RESET` | Audit entry when demo wallet reset |
| `ADJUSTMENT` | Manual admin correction |

Every `Transaction` carries `balanceBefore` + `balanceAfter` and an optional `idempotencyKey` to dedupe retries.

## Authentication

### Routes

| Route | Access | Behaviour |
|---|---|---|
| `/` | **Public** | Game board is viewable by anyone. Header shows `👤 Anonymous` + **SIGN IN** pill when unauthenticated, user's name + dropdown when authenticated. |
| `/login` | Public (redirects to `/` if already authed) | Phone + password sign-in. Supports `?next=/wallet` for deep-link redirect after login. |
| `/register` | Public (redirects to `/` if already authed) | Phone + password sign-up. Creates User + both wallets automatically. |
| `/logout` | POST from an authed session | Revokes the session row + clears the cookie. |
| `/wallet` | **Protected** | Throws redirect to `/login?next=/wallet` for anonymous visitors. |
| `/history` | **Protected** | Throws redirect to `/login?next=/history`. |
| `/profile` | **Protected** | Throws redirect to `/login?next=/profile`. |

### Customer flow

- **Register**: `tel` + `password` only. Other fields (firstName, lastName, profile, dob) optional and editable later from `/profile`.
- **Login**: `tel` + `password`.
- **Forgot password**: there is no self-service reset — customer taps the **"Forgot password?"** link on `/login` which opens WhatsApp to admin (**`+856 20 7885 6194`**) prefilled with a template message. Admin updates the password manually via the admin panel; every reset writes an `AuditLog` entry.

### Admin flow

- **Login**: `email` + `password`. Optional TOTP 2FA supported in schema (`twoFactorSecret`, `AdminSession.twoFAPassed`).
- Admin-only routes (`/admin/*`) are not built yet — the current host-controls stub uses `?admin=1` on `/` as a temporary placeholder.

### Session cookie

- **Name**: `pupatao_session`
- **Attributes**: `HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` (30 days). Adds `Secure` in production.
- **Storage**: cookie carries the raw token; DB stores only `SHA-256(token)` in `Session.tokenHash`. Revoked sessions set `revokedAt` — the lookup treats them as absent.
- **Implementation**: see [`app/lib/auth.server.ts`](app/lib/auth.server.ts). The key helpers:
  - `createUserSession(userId, request, redirectTo)` — issues session + `Set-Cookie` + redirects.
  - `getCurrentUser(request)` — returns `User | null`. Use in loaders that tolerate anonymous visitors.
  - `requireUser(request)` — returns `User` or **throws a redirect** to `/login?next=<path>`. Use in protected loaders.
  - `logout(request, redirectTo)` — revokes + clears cookie.

## Development

### Prerequisites
- **Bun ≥ 1.2**
- **MongoDB Atlas** cluster (or local MongoDB replica set). Single-node Mongo without `--replSet` will NOT support Prisma transactions — balance-changing writes require a replica set.

### Setup

```bash
# 1. Install deps
bun install

# 2. Create .env with your Mongo connection string
echo 'DATABASE_URL="mongodb+srv://USER:PASS@cluster.mongodb.net/pupatao?appName=pupatao"' > .env

# 3. Push schema + generate Prisma Client
bun run db:push

# 4. Seed one admin + one test user
bun run db:seed

# 5. Run the app
bun run dev
# → http://localhost:5173
```

### Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Start dev server (HMR + dev SW) |
| `bun run build` | Production build (server + client bundles) |
| `bun run start` | Serve the production build |
| `bun run typecheck` | `react-router typegen` + `tsc --noEmit` |
| `bun run db:push` | Sync `schema.prisma` to MongoDB |
| `bun run db:seed` | Run idempotent seed (`prisma/seed.ts`) |
| `bun run db:studio` | Open Prisma Studio at `http://localhost:5555` |

## Seed credentials

The seed creates one of each role for local testing. **Change these before shipping to production.**

### Admin

| Field | Value |
|---|---|
| Email | `admin@pupatao.com` |
| Password | `admin1234` |
| Role | `SUPERADMIN` |

### Customer

| Field | Value |
|---|---|
| Tel | `+8562099999999` |
| Password | `test1234` |
| Role | `PLAYER` |
| Demo wallet | `1,000,000 ₭` |
| Real wallet | `0 ₭` |

The seed is **idempotent** (`upsert`) — re-running it won't duplicate or overwrite passwords on existing accounts.

## PWA

Installable and offline-capable via `vite-plugin-pwa`.

- **Manifest**: `/manifest.webmanifest` (auto-generated, theme `#1e0040`, display `standalone`, orientation `portrait`).
- **Service Worker**: `registerType: "autoUpdate"` — new SW activates on the next navigation.
- **Precache**: all JS/CSS/HTML/SVG/PNG/JPG assets including dice symbols.
- **Install** — desktop: click the "Install" icon in the address bar. iOS Safari: Share → Add to Home Screen. Android Chrome: menu → Install app.

## Admin `?admin=1` stub

Until a real `/admin` route is built, append `?admin=1` to `/` to reveal the host panel (Start Round / Enter Result). This is **local-only state** — it does not sync between devices. Real cross-device sync arrives when the backend session is wired up.

## Architecture notes

### Balance mutations — always transactional

Every balance-changing write (bet place, round resolve, transfer, deposit, withdraw) **must** run inside `prisma.$transaction([...])` with **optimistic locking** via `Wallet.version`:

```ts
await prisma.$transaction([
  prisma.wallet.update({
    where: { id: walletId, version: currentVersion },
    data: { balance: { decrement: amount }, version: { increment: 1 } },
  }),
  prisma.transaction.create({ data: { …, balanceBefore, balanceAfter } }),
  prisma.bet.create({ data: { … } }),
])
```

Single-node MongoDB without replica-set mode will silently drop transactional guarantees — **use Atlas or `--replSet`**.

### Append-only ledger

Never delete `Transaction` rows. For corrections emit a reversing entry (`REFUND` / `ADJUSTMENT`) and transition the original to `FAILED` or `CANCELLED`.

### Idempotency

Client-originated writes (deposit, withdraw, transfer) should pass an `idempotencyKey`. Retries from flaky mobile networks or PWA re-sends won't double-debit.

## Roadmap

- [ ] Move `user-store.ts` from localStorage to server-side Prisma queries.
- [ ] Build `/admin` route with proper email+password login + 2FA.
- [ ] Multi-device realtime sync for LIVE mode (WebSocket / Firebase / Supabase Realtime).
- [ ] WebRTC for the host's webcam feed (replacing the YouTube iframe placeholder).
- [ ] Real payment-provider integration for DEPOSIT / WITHDRAW (BCEL One, LDB, U-Money).
- [ ] Real peer-to-peer TRANSFER (currently format-validated stub only).
- [ ] Play-history filter by date range / bet type / wallet.

## License

Private.
