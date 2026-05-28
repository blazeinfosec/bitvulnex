# Changelog

This file is the source for the in-app `/about/changelog` page. From
Phase 9 onward, entries here may contain **diegetic hints** about
planted vulnerabilities — references to "fixed" issues that hint at
adjacent unfixed ones, TODOs left in the code, etc. They are part of
the lab.

## 2026-05-31 — Phase 4: spot trading & order book

- New: BTC/USDT and ETH/USDT pairs. Limit and market orders.
- New: live order book at `wss://exchange.local/ws`. Subscribe
  to channels by name (`book:BTC/USDT`, `trades:BTC/USDT`,
  `private:<userId>`).
- New: advanced order types (stop-loss, OCO) for tier-2+ users.
- New: fee tiers (base / vip / prime) recalculated on each trade
  from your last 30 days of volume.
- New: `/api/v2/public/price/{pair}` and `/api/v2/public/book/{pair}`
  cached at the edge for 5 seconds.
- Internal: matching engine runs in-process on the web tier.
  Phase 5 may extract it to a dedicated service if margin needs it.

## 2026-05-30 — Phase 3: deposits & address management

- New: BTC deposit addresses (derived from the mock regtest node).
- New: `Balance` table tracks the running per-asset position;
  Phase-4 trading will consume it.
- New: deposit worker polls the chain every 5s; credits balance
  after enough confirmations for the user's KYC tier.
- Internal: premium tier-3 users receive **instant credit**
  (0-confirmation) to avoid waiting through chain congestion.
  Reconciliation on RBF drops is tracked as DEPOSIT-271 and not
  yet implemented.
- Lab: dev affordances under `/api/v2/dev/btc/*` (send/mine/rbf)
  for trainee testing. Gated by `LAB_AFFORDANCES_ENABLED` env var.
- Internal: a shared `isValidBtcAddress()` helper now backs
  address validation across the codebase. Phase 7+ withdrawal
  will consume it. We accept mainnet/testnet/regtest HRPs from a
  single function to support clients across networks.

## 2026-05-29 — Phase 2: KYC & identity

- New: KYC profile + document upload + multi-tier verification.
- New: admin review queue at `/admin/kyc` with inline doc previews.
- New: tier-gated limits via `requireTier()` helper — Phase 4
  trading endpoints will consume it.
- New: document URL-import endpoint. We block obvious local
  addresses on inbound URLs.
- Internal: documents are served directly from the uploads
  directory; the admin review iframe uses the stored mime type.
- Internal: mock instance-metadata service (mock-imds) added to
  docker-compose for CHAIN D landing — no host port mapping.

## 2026-05-28 — Phase 1: authentication

- New: signup, login, password reset, TOTP-based 2FA.
- New: scoped API keys (read / trade / withdraw).
- New: admin endpoints under `/api/v2/admin/*` for user management.
- Legacy `/api/v1/*` mount remains available for mobile-app v1.x
  clients still in the field. v1 tokens are signed with the
  `legacy-2022` key (see `/api/.well-known/jwks.json`).
- Internal: refresh-token rotation is **not** yet wired (tracking
  ticket AUTH-114).
- Internal: middleware short-circuits on `x-middleware-subrequest`
  to skip auth checks for Next.js's own internal probes.

## 2026-05-27 — Phase 0: initial scaffolding

- Repository bootstrap: pnpm workspace, Next.js 15, Prisma + Postgres,
  Redis + BullMQ, nginx reverse proxy, mock bitcoind container.
- Design system: institutional palette, Inter, shadcn/ui primitives.
- No business features yet. No planted vulnerabilities. Stay tuned.
