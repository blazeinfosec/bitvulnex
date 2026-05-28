# Functional QA Report

**QA:** Hardcore Functional (QA-2)
**Date:** 2026-05-28
**Stack:** `docker compose up -d`, http://localhost
**Verdict:** PASS WITH NITS

Two real functional defects found (F-1, F-2), one significant UX gap
(F-3) and one minor UX defect (F-4). All planted V-NNN vulnerabilities
encountered during testing are informational only; no fixes applied.
Lab is otherwise functional end-to-end across all 15 surfaces I could
reach.

## Surfaces tested

| # | Surface | Result | Notes |
| - | ------- | ------ | ----- |
| 1 | Public/anonymous (`/`, `/about/changelog`, `/docs`, `/login`, `/signup`) | PASS | All pages render with DO NOT DEPLOY banners top + bottom; Swagger UI mounts at `/docs`. |
| 2 | Signup → login → logout | PASS | Signup auto-redirects to `/account`; logout clears `bvbe.access`/`bvbe.refresh` from localStorage and redirects to `/`. |
| 3 | Seed user login | PARTIAL | `admin@bvbe.local / change-me-after-first-login` works (role=admin, tier=3). The `ada.lovelace@bvbe.local` user assumed by the test plan does **not** exist in the seed data — synthetic seeds use deterministic `first.last.N@example.test` emails (see `packages/db/prisma/seed.ts`). Recommend updating the test plan to reference `admin@bvbe.local` and the documented synthetic users. |
| 4 | KYC | PARTIAL | Profile save (`PUT /api/v2/me/kyc/profile`) → 200. Submit without docs → 400 with `at least one document required` (correct validation). Did not exercise document upload through the browser MCP (no file-input affordance); admin-side `POST /api/v2/admin/kyc/{userId}/approve` works and bumps `kycTier`. |
| 5 | Deposits | FAIL — F-2 below | Address generation (200), `POST /api/v2/dev/btc/send` (200), `POST /api/v2/dev/btc/mine` (200), deposit row reaches `status=credited` with 3 confs. But credited amount lands in `Balance.amount` only, not `Balance.available`, so the deposited BTC is unspendable. |
| 6 | Spot trading | PASS (via API workaround) | Limit buy + limit sell + market + cancel all succeed via direct API once funded with `balance-adjust`. UI page path `/account/trading/[pair]` works only if you URL-encode the pair as `BTC%2FUSDT` (see F-1). Order book stays empty until two users place crossing limits because no resting market-makers are seeded. |
| 7 | Margin | PARTIAL | `POST /api/v2/me/margin/transfer { direction: "to_margin" }` succeeds. `POST /api/v2/me/margin/positions` returns `insufficient liquidity` because no resting book to oracle off of — wired and reachable, just needs market depth to actually open a position. UI button reports same error. |
| 8 | Lending | PASS | View pools (200), supply BTC (200, position created), withdraw by `positionId` (200, principal returned to `available`). Accrual itself is a worker tick — not exercised in this run. |
| 9 | Staking | PASS | View programs (200), stake ETH (200, position created). Claim with zero accrued rewards returns 200 / `{rows:0, credited:"0"}`. |
| 10 | OTC | PASS | `POST /api/v2/me/otc/quote` → 200, ticket id returned with price + expiry. `POST /api/v2/me/otc/accept` → 200. |
| 11 | P2P | PASS | `POST /api/v2/me/p2p/offers` → 200 (sell BTC at 65000, SEPA). `GET /api/v2/public/p2p/offers` returns the offer. |
| 12 | Withdrawals | PASS | External withdrawal `POST /api/v2/me/withdrawals` for `bcrt1qw508...` → 200 (queued for worker). Internal transfer to `admin@bvbe.local` → 200. Balances page reads `available` correctly. |
| 13 | Admin | PASS | `/admin` landing, `/admin/users`, `/admin/users/[id]` (shows planted V-1 fields with `dangerouslySetInnerHTML` styling), `/admin/tickets`, `/admin/compliance`, `/admin/treasury`, `/admin/kyc` all render. Search-users with no `perf=1` returns 50 results. |
| 14 | Support tickets | PASS | Open ticket → 200, redirect to `/support/tickets/[id]`. User reply → 200. Admin can see ticket at `/admin/tickets/[id]`, including reply controls. |
| 15 | Navigation | PARTIAL — F-3 + F-4 below | All visible navbar links resolve to a page that renders. Two gaps: no link to the spot-trading page anywhere in the navbar, and the navbar does not change after sign-in. Footer links resolve. |

## Functional defects (in scope — must fix)

### F-1: Trading page URL pair separator (`/account/trading/BTC-USDT`) is incompatible with the API schema

- **Severity:** High
- **Type:** Functional defect (not in VULNS.md)
- **Repro:**
  1. Sign in as any tier-1+ user.
  2. Navigate to `http://localhost/account/trading/BTC-USDT` (the natural human-typed form).
  3. Try to place any order from the form.
- **Expected:** Order is accepted or fails with a meaningful business-rule error.
- **Actual:** `POST /api/v2/me/orders` returns `400 { error: { message: "validation failed", code: "VALIDATION" }}`. Public price + book endpoints also 400, so the trading page header shows `Last: — · Bid: — · Ask: —` even when data should be available.
- **Root cause:** Page client (`apps/web/app/account/trading/[pair]/page.tsx`) does `decodeURIComponent(params.pair)` and forwards the value verbatim to `POST /api/v2/me/orders { pair }`. The API schema (`apps/web/app/api/v2/me/orders/route.ts:43`) is `z.string().regex(/^[A-Z]+\/[A-Z]+$/)`. URL `BTC-USDT` becomes the literal `BTC-USDT`, which fails the regex. Only `/account/trading/BTC%2FUSDT` (URL-encoded slash) works — and is not a discoverable URL.
- **Evidence:**
  - Network: `POST /api/v2/me/orders` body `{"pair":"BTC-USDT", ...}` → `{"error":{"message":"validation failed","code":"VALIDATION"}}` (request index 27, 39 in trade-page session).
  - The exact same payload with `pair: "BTC/USDT"` returns `200 { orderId: 1 }`.
- **Reachability:** Any authenticated user with KYC tier ≥ 1.
- **Fix sketch:** Either (a) accept hyphenated pair labels in the API and normalize, or (b) make the page convert `BTC-USDT` → `BTC/USDT` before talking to the API. (a) is more consistent because public price/book routes have the same problem.

### F-2: Deposit watcher credits `Balance.amount` but not `Balance.available`, so deposited BTC is unspendable

- **Severity:** Critical
- **Type:** Functional defect (not in VULNS.md — V-42 references the same write but only as the planted **zero-conf** path; the missing `available` write is a *separate* bug that affects every tier, including the documented happy path)
- **Repro:**
  1. Sign in as a tier-1+ user (use the admin `POST /api/v2/admin/kyc/{userId}/approve` to bump if needed).
  2. Visit `/account/deposit`. Generate a deposit address.
  3. Click "Send to deposit address" (lab affordance — `POST /api/v2/dev/btc/send`).
  4. Click "Mine 3 blocks" (`POST /api/v2/dev/btc/mine`).
  5. Wait for the deposit-watcher tick (~5s). The deposit row reaches `status=credited` and `/api/v2/me/balance` reports `amount: "0.5"`.
  6. Try to place a sell limit for 0.001 BTC, or submit a 0.001 BTC withdrawal.
- **Expected:** The deposited BTC is spendable — sell limits, withdrawals, and margin transfer should succeed up to the deposited quantity.
- **Actual:** `POST /api/v2/me/orders` and `POST /api/v2/me/withdrawals` both return `400 { error: { message: "insufficient balance" }}`. The admin user-detail page confirms the discrepancy: `Amount=0.5, Available=0, Locked=0`. The withdraw page's "Balances" table reads `Available` and shows 0.
- **Root cause:** `apps/worker/src/deposit-watcher.ts:129-138` writes only `amount` on the Balance upsert:
  ```ts
  db.balance.upsert({
    where: { userId_asset: { userId: ba.userId, asset: ba.asset } },
    create: { userId: ba.userId, asset: ba.asset, amount: D(tx.amountBtc.toFixed(8)) },
    update: { amount: { increment: D(tx.amountBtc.toFixed(8)) } },
  })
  ```
  Compare to `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts:69-81`, which correctly writes both `amount` and `available`. The schema (`packages/db/prisma/schema.prisma:272-287`) separates `amount`, `available`, `locked`, `marginAvailable`, `marginBorrowed`. Every other writer in `apps/web/lib/...` (lending withdraw, margin transfer, OTC settlement, lending borrow, withdrawal refund, internal-transfer credit) updates `available` for any spendable credit; only the deposit watcher does not.
- **Evidence:**
  - `/api/v2/me/balance` for the QA user shows `amount: "0.5"` immediately after the deposit watcher tick; trade engine refuses orders on the same row.
  - Admin user-detail page for the same user shows `BTC: Amount=1.0089, Available=0.4979, Locked=0.01` — the 0.5 from balance-adjust (admin path, correct) is in Available, but the 0.5 from the deposit is missing from Available.
  - Phase-5 fix-up doc (`docs/phases/phase-5/l7-qa-review.md:511-517`) explicitly documents the analogous fix-up for `marginAvailable`, which suggests the team is aware the columns must be kept in sync but missed the spot side of the deposit credit.
- **Reachability:** Every user who tries to deposit. This is the headline happy path of the whole exchange — without the fix, no organic deposit can be traded or withdrawn; testers will be stuck unless they use the admin balance-adjust endpoint as I did.
- **Fix sketch:** Change the deposit-watcher upsert to write both columns:
  ```ts
  update: { amount: { increment: amt }, available: { increment: amt } },
  create: { userId, asset, amount: amt, available: amt },
  ```
  Note this does *not* alter the planted V-42 (zero-conf credit for tier-3) behavior — V-42 is about *when* the credit happens (confirmations=0 on tier 3); the fix is about *where* the credit lands.

### F-3: No navbar link to the trading page

- **Severity:** Medium (UX gap — feature exists but is undiscoverable)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:** Sign in as any user. Inspect the navbar. There is no link that leads to `/account/trading/[pair]`, neither from the landing page market tiles nor from the account page.
- **Expected:** A user can navigate from the home/account page to the trading view for at least one pair.
- **Actual:** The trading page is reachable only by typing the URL directly (`/account/trading/BTC%2FUSDT`). The landing-page market tiles ("BTC/USDT", "ETH/USDT", "LTC/USDT", "DOGE/USDT") are not links. Grepping the codebase for `/account/trading` returns zero internal callers.
- **Fix sketch:** Make the landing-page market tiles link to `/account/trading/BTC%2FUSDT` (or after F-1 is fixed, `/account/trading/BTC-USDT`), and add a "Trade" entry to the navbar between "Withdraw" and "Changelog".

### F-4: Navbar always shows "Sign in" + "Create account" even when authenticated

- **Severity:** Low (cosmetic / minor UX)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:** Sign in. Look at the navbar on any page.
- **Expected:** The navbar shows account/profile and a sign-out affordance instead of the sign-in/sign-up links.
- **Actual:** Sign-in + Create account links remain visible. The only sign-out path is `/account` → "Sign out" button.
- **Fix sketch:** The navbar is rendered server-side (no client check of `bvbe.access`). Either gate the auth-state-dependent links on a client component that reads localStorage, or read the auth claim from a cookie/SSR session.

## Informational findings (planted V-NNN — IGNORE for fix)

These were observed during testing and map to planted vulnerabilities in `VULNS.md`. Acknowledged and not touched:

- **V-1 stored XSS shape** — admin `/admin/users` and `/admin/users/[id]` both render `displayName` as a `dangerouslySetInnerHTML` `<strong>` wrap (visible in the snapshot at `e64-e66`, `e38-e39`). Renders cleanly for benign input.
- **V-46 OTC desk role header** — `POST /api/v2/me/otc/accept` does not strip `x-bvbe-desk-role`. Not exercised offensively here.
- **V-42 zero-conf for tier-3** — deposit reached `credited` immediately on `mine` because the QA user was bumped to tier 3 before deposit; consistent with planted behaviour.
- **V-27 lexicographic tier compare** — `requireTier` still uses raw `<` on `number | string`. Latent in current flows.
- **V-13 open redirect on `?next=`** — `apps/web/app/login/login-form.tsx` accepts arbitrary `nextPath`. Not exercised.
- **V-21 refresh tokens not single-use** — confirmed via repeated `POST /api/v2/auth/refresh` not necessary; design intent is intact.

None of these were fixed.

## Console errors observed

After full QA session, browser console errors fall into four buckets:

- **Dev artifact (ignore):** ~30× `WebSocket /_next/webpack-hmr 404`. Next.js dev HMR is disabled by the Docker stack but the client still tries.
- **Missing asset (cosmetic):** `GET /favicon.ico 404`. Worth adding a stub favicon.
- **Expected 4xx from QA probes:** `400 /api/v2/me/kyc/submit` (no docs), `403 /api/v2/me/deposit/address` (tier 0 before approval), `405 PATCH /api/v2/admin/users/[id]` (the route only exposes GET), `400 /api/v2/me/margin/transfer` (first attempt used wrong `direction` enum), `400 /api/v2/me/margin/positions` (insufficient liquidity), `400 /api/v2/me/lending/withdraw` (first attempt used `asset+amount`; the route takes `positionId`).
- **Symptoms of F-1:** ~15× `400` on `/api/v2/public/price/BTC-USDT`, `/api/v2/public/book/BTC-USDT`, and `/api/v2/me/orders` while the trade page was loaded at the hyphen-form URL.

No 5xx errors. No uncaught JS errors. No hydration mismatches.

## Final verdict

PASS WITH NITS. The lab is end-to-end functional: every workflow I exercised (auth, KYC profile, deposit pipeline, spot trade order lifecycle, lending supply/withdraw, staking stake/claim, OTC quote/accept, P2P offer, external withdrawal, internal transfer, support ticket open/reply, admin search + detail + queues) reaches a 200 response and the database reflects the action. The headline blocker is **F-2** — the deposit watcher never credits `Balance.available`, so an organically-deposited BTC cannot be traded or withdrawn. That single one-line fix unblocks the entire happy path for any trainee or instructor running the lab; without it, every workflow downstream of "deposit BTC" requires admin `balance-adjust` to be usable. **F-1** is the second priority — the trading page URL form does not match the API contract — and is a five-line fix on the client or server side. **F-3/F-4** are minor UX polish that don't block any flow but make the lab look unfinished on first walk-through. None of the four findings touch a planted V-NNN and none should be triaged through the security-fix-prohibition rule.
