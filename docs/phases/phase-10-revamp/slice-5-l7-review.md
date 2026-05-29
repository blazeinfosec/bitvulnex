# Phase 10 Slice 5 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `f8f23d2` — "phase 10.5: portfolio dashboard + equity curve + welcome onboarding"
**Verdict:** **PASS WITH NITS**

## Methodology

Read:
- `CLAUDE.md` (the "do not fix planted vulns" rule)
- `VULNS.md` entries called out in the commit (V-4, V-22, V-23, V-25, V-27, V-32, V-43, V-44, V-45, V-50)
- the slice-5 diff (`git show f8f23d2`)
- new code: `apps/worker/src/equity-snapshot.ts`, `apps/web/app/api/v2/me/dashboard/route.ts`, `apps/web/lib/portfolio/activity.ts`, `apps/web/app/portfolio/page.tsx` + `portfolio-client.tsx`, six new components under `apps/web/components/exchange/portfolio/`
- migration `packages/db/prisma/migrations/20260601030000_phase_10_equity_snapshots/migration.sql`
- worker index registration in `apps/worker/src/index.ts:18,52,86,93,129,221-233,244,251,258`

Ran (Bash):
- `git diff HEAD~1 HEAD -- <V-NNN paths>` (single command listing all paths)
- `pnpm test` → 148/148 green
- `pnpm --filter @bvbe/{web,worker} exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` → clean; `/portfolio` first-load JS = 185 kB
- `docker compose ps -a` → 9/9 up; `db-migrate` exited 0; `worker` logs include `[worker] equity-snapshot ready`
- direct SQL into `equity_snapshots` table → 55 rows already materialised across 56 users

Ran (Playwright MCP):
- unauthenticated `/portfolio` → bounced to `/login?next=/portfolio`
- fresh signup `qa-l7-s5-1780053944768@bvbe.local` (Tier 0) → `/api/v2/me/dashboard` returns 403 `{code:"TIER"}` as designed
- V-22 PoC live: `PATCH /api/v2/me` with `{kycTier:1, emailVerified:true}` from the Tier-0 user → 200 OK, user object returned with `kycTier:1` (`emailVerified` correctly remains false — see below)
- re-login → fresh JWT with `kycTier:1`, dashboard returns 200 with empty payload
- WelcomeCard dismissal: click `[aria-label="Dismiss welcome checklist"]` → `localStorage["bvbe.ui.portfolio.welcomeDismissed"] === "1"`; reload retains dismissal; `localStorage.removeItem(...)` + reload brings it back
- `mm.alpha@bvbe.local` (Tier 3) → full dashboard: $2.997B equity, 6 balances, 50 activity rows, 240 open orders, equity curve canvas mounted
- `?tab=positions` URL → bottom strip switches to "No open margin positions" empty state
- mobile 375×667 viewport → screenshot saved at `./slice-5-l7-mobile.png`: stats single-column, balances/activity stacked, WelcomeCard 5 steps stacked

## V-NNN regression spot-check

`git diff HEAD~1 HEAD -- apps/web/app/api/v2/me/orders/ apps/web/lib/engine/ apps/web/lib/kyc-tier.ts apps/worker/src/yield-accrual.ts apps/web/lib/staking/ apps/web/lib/lending/ apps/web/lib/withdrawal/ apps/web/lib/treasury/ apps/web/lib/otc/ apps/web/lib/p2p/ apps/ws-gateway/src/server.ts nginx/nginx.conf` returned **empty**. All ten claimed quarantines hold.

- **V-4** (`/api/v2/me/orders/`) — empty diff ✓
- **V-22** (mass-assignment `/api/v2/me` PATCH) — **live PoC**: a Tier-0 user PATCHed `kycTier:1` and the field was honored (200 OK, follow-up login JWT contains `kycTier:1`). NOTE: the request body also included `emailVerified:true` which silently dropped — the PATCH zod schema in `apps/web/app/api/v2/me/route.ts:52-58` doesn't list `emailVerified`. That is not a slice-5 regression; it's the existing V-22 surface as planted.
- **V-23** (`apps/ws-gateway/src/server.ts`) — empty diff ✓
- **V-25, V-32, V-43** (`apps/web/lib/engine/`) — empty diff ✓
- **V-27** (`apps/web/lib/kyc-tier.ts`) — empty diff ✓; the new dashboard handler imports and uses `requireTier(claims, 1)` so the V-27 reach is preserved across the new surface (a forged tier claim would pass the gate just as elsewhere)
- **V-44** (`apps/worker/src/yield-accrual.ts`, `apps/web/lib/lending/`) — empty diff ✓
- **V-45** (`apps/web/lib/staking/`) — empty diff ✓
- **V-26/28/30/47** (`apps/web/lib/withdrawal/`) — empty diff ✓
- **V-33** (`apps/web/lib/treasury/`) — empty diff ✓
- **V-46** (`apps/web/lib/otc/`) — empty diff ✓
- **V-50** (`nginx/nginx.conf`) — empty diff ✓

No quarantined surface was touched. No planted vuln was "patched". No new code in slice 5 silently hardens a planted hole.

## Live verification

| Check | Result |
|---|---|
| Unauth → /portfolio | 200 HTML, client redirects to /login?next=/portfolio (cleanly) |
| Unauth → /api/v2/me/dashboard | 401 `{error:"unauthorized"}` |
| Tier-0 → /api/v2/me/dashboard | 403 `{code:"TIER", message:"KYC tier 1 required"}` |
| V-22 PoC (PATCH /api/v2/me kycTier:1) | 200, tier bumped |
| Tier-1 fresh → /portfolio | renders: 1/5 onboarding complete (KYC step ✓), $0 equity, equity-curve empty state, "No balances yet", "No activity yet", Tier 1 → Tier 2 progress card |
| WelcomeCard dismiss persists across reload | ✓ |
| Clearing dismiss flag restores card | ✓ |
| Tier-3 (mm.alpha) full data | $2.997B equity, +0.06% / +$1.75M 24h delta, equity-curve canvas rendered, 6 balances sorted desc, 50 activity rows, BottomTabs shows "Open orders 240" badge, Tier 3 "Max tier" card with full progress bar |
| `?tab=positions` URL state | bottom strip switches; "Open positions" tab visibly active |
| 375×667 mobile | stats single column, balances/activity stacked, WelcomeCard 5 steps stacked (full-page screenshot captured) |
| Activity row link → /trade/BTC-USDT | links present per ActivityFeed columns (Link href set from event.link) |
| Console errors | 1 noise error: HMR websocket 404 (`ws://localhost/_next/webpack-hmr`) — nginx doesn't proxy the dev HMR socket; pre-existing in earlier slices |

## Component audit

### `apps/worker/src/equity-snapshot.ts`

- math correctly mirrors the documented formula: spot.amount * px + marginAvailable * px + lending(supply principal+accrued credit / borrow principal+accrued debit) + staking.principal + margin.collateral + size * (mark − entry) * quote_px
- `priceCache` initialises USDT/USDC to 1 and memoises lookups; missing `<asset>/USDT` trade resolves to 0 and the asset is skipped via `if (px.lte(0)) continue;` — sensible fallback (no throw)
- `Prisma.Decimal` end-to-end, no `Number` slippage on values
- `db = prisma` DI seam matches the other five workers (`deposit-watcher`, `liquidation-watcher`, `yield-accrual`, `staking-rewards`, `withdrawal-processor`)
- idempotent: `upsert` keyed on `(userId, date)` matches the `@@unique` constraint in `schema.prisma:792`
- 5-min cadence documented in code (`apps/worker/src/equity-snapshot.ts:21-22`) and in `apps/worker/src/index.ts:127-138`
- live verification: 55 rows present in `equity_snapshots` after the stack ran for ~25 min; admin/mm.alpha snapshots show realistic ~$3B values; freshly-signed-up qa-l7 user has a $0 row (worker doesn't skip zero-balance users — see Minor M-3)

5 unit tests in `apps/worker/src/equity-snapshot.test.ts` cover: spot-only, lending supply, margin P&L, no-price fallback, upsert idempotency.

### `apps/web/app/api/v2/me/dashboard/route.ts`

- 401 on missing token, 403 with `code:"TIER"` on tier 0 — both verified live
- 20 parallel reads via `Promise.all`; all scoped to `claims.sub`; no leakage paths
- counts object accurate (manual cross-check: `mm.alpha` shows `openOrders:240`, `openPositions:0`, all earn counts 0)
- snapshots out: maps to `{date, totalUsd}`; appends/updates a synthesized "today" point so the curve moves between worker ticks
- `tierRequirements` produces sensible strings for Tier 0→1→2→3 transitions (verified: Tier 1 mm.alpha → no requirements; tier 1 qa-l7 user → "Verify your email address", "Upload an ID document (Tier 2 KYC)")
- 24h delta math: looks for the most-recent snapshot ≥ ~24h old, falls back to the oldest available; for 0 snapshots returns `deltaUsd:"0.00", deltaPct:0`; the UI hides the percent change behind a "Awaiting first snapshot baseline" hint when `equitySnapshots.length < 2` (`portfolio-client.tsx:296-303`)
- **Defect (Major M-1)**: `liveEquity` aggregation excludes:
  - margin position collateral + unrealized P&L (worker counts both; API only sums spot+marginAvailable+lending principal+staking principal)
  - lending `accrued` (worker counts `principal + accrued`; API counts only `principal`)
  See `apps/web/app/api/v2/me/dashboard/route.ts:301-330` vs `apps/worker/src/equity-snapshot.ts:96-159`. Effect: a user who has open margin positions or accrued lending interest will see today's live equity point on the curve drop below yesterday's snapshot point, producing a misleading "you just lost money" 24h delta. With current seed data (0 open margin positions, 0 accrued lending) the bug doesn't manifest — but the surface is reachable by any trainee who opens a margin position or supplies for a while.

### `apps/web/lib/portfolio/activity.ts`

- pure function (no DB calls) ✓
- merges deposits, withdrawals, transfers in/out, taker/maker trades, order placed *and* cancelled (two events per order when `cancelledAt` set, see lines 180-202), stake+unstake, supply+supply_withdraw, borrow+repay, OTC, P2P (buyer/seller)
- newest-first sort by ISO timestamp; cap defaults to 50
- 4 unit tests cover dedup+sort+cap

### `apps/web/app/portfolio/page.tsx` + `portfolio-client.tsx`

- server shell defers everything to client; `dynamic = "force-dynamic"` set
- client island fetches `/api/v2/me/dashboard` on mount; 401 → `router.replace("/login?next=/portfolio")`; 403 → tier-gate banner (yellow warn card with "Verify identity →" CTA); other errors → "Could not load dashboard"
- `?tab=` reads via `useSearchParams`, writes via `router.replace`; effect re-syncs state when `tabParam` changes (browser back/forward works)
- loading state via `PortfolioSkeleton` ✓
- `EquityCurve` is lazy-loaded via `next/dynamic({ssr:false})` — lightweight-charts is NOT in the first-load chunks for `/`, `/markets`, etc. (verified in `pnpm build` output; only `/portfolio` and `/trade/[pair]` include the chart bundle)

### Six new components

- **WelcomeCard** — 5 steps: Verify email / KYC / First deposit / First trade / Try Earn; done state computed from `payload.onboarding`; dismissable via × button with localStorage persistence (`bvbe.ui.portfolio.welcomeDismissed === "1"`); auto-hides when `steps.every(s => s.done)`. Live-verified across multiple reloads.
- **EquityCurve** — `lightweight-charts` AreaSeries with gradient; lazy-loaded; empty-state when `< 2` points; double `useEffect` (chart instance vs data) is intentional and correct.
- **TierProgressCard** — progress bar at `(current/3)*100`; "Max tier" state at Tier 3; CTA to `/account/kyc` shown only when `next !== null && requirements.length > 0`.
- **BalancesTable** — sorts by `usdValue` desc, filters by `Number(b.amount) > 0` (see Minor M-2). Empty state with "Deposit" CTA.
- **ActivityFeed** — formats timestamps as `YYYY-MM-DD HH:mm UTC`, kind pill with green/red/neutral semantic colors, scrollable container capped at 480px height + slice(0, limit).
- **BottomTabs** — generic, accessible (`role="tablist"`, `aria-selected`), optional count badge that recolors when active.

## Functional defects beyond V-NNN

### M-1 (Major) — Live equity calc misses margin P&L and lending accrued

Already detailed above. Concrete impact: any user with an open margin position will see a misleading 24h delta because today's "live" point doesn't include their unrealized P&L while yesterday's worker snapshot does. The fix is symmetrical: re-use `computeUserEquity` from the worker (or move it to a shared lib) and call it from the dashboard handler instead of re-implementing a subset.

Path: `apps/web/app/api/v2/me/dashboard/route.ts:301-330` should mirror `apps/worker/src/equity-snapshot.ts:73-162`.

### M-2 (Minor) — BalancesTable filters by spot amount only

`apps/web/components/exchange/portfolio/BalancesTable.tsx:26` filters with `Number(b.amount) > 0`, hiding assets that have moved entirely into `marginAvailable`. A user who deposits BTC then transfers it all to the margin sub-account would see no BTC row at all. Current seed data has no such users (verified via SQL: `SELECT COUNT(*) FROM balances WHERE amount = 0 AND "marginAvailable" > 0` = 0) so the bug doesn't manifest today. Fix: `Number(b.amount) + Number(b.marginAvailable) > 0` or compare `usdValue > 0`.

### M-3 (Nit) — Worker creates $0 snapshots for users with no balance

`apps/worker/src/equity-snapshot.ts:169` iterates **all** users every 5 min; users with no activity get a $0 row per UTC day. On a 56-user lab with 55 snapshots after the first tick, that's 0 wasted-row debt today but grows ~unboundedly as the user table grows. Acceptable for a lab; document or skip when total == 0 && previous_total == 0.

### M-4 (Nit) — `qa-l7-s5` user displayed as "QA L7 Slice 5" in heading

Not a bug, but `portfolio-client.tsx:255` uses `payload.user.displayName || payload.user.email.split("@")[0]`. The displayName is HTML-rendered as text via JSX (React escapes), so this is not the planted XSS surface — confirmed safe interpolation. Listed only because I checked.

### M-5 (Nit) — 50-row activity cap with no pagination

The plan documents this. No "Load more" affordance, just truncation. mm.alpha has thousands of trades so the dashboard shows only the freshest 50. Fine for a "between actions" landing page; a follow-up slice could add a "View full history" link, but it's not blocking.

### M-6 (Observation, not a defect) — `emailVerified` not set by V-22 PATCH

The V-22 schema (`apps/web/app/api/v2/me/route.ts:52-58`) accepts `kycTier` but not `emailVerified`. So the live PoC sent `{kycTier:1, emailVerified:true}` and only `kycTier` was applied. **This is the planted vuln's existing surface; not a slice-5 regression.** The trainee gets enough — Tier 1 reaches all the gated endpoints — and the dashboard onboarding shows `emailVerified:false` accurately. No code change needed.

## Build / test / docker

- `pnpm test` — 148/148 passing (slice spec said +9 new; activity.test.ts adds 4 and equity-snapshot.test.ts adds 5 = +9 ✓)
- `pnpm --filter @bvbe/web exec tsc --noEmit` — clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` — clean
- `pnpm --filter @bvbe/web build` — clean; `/portfolio` first-load JS = **185 kB** (under the 200 kB budget; matches commit claim)
- `docker compose ps` — 9/9 services up (db, db-migrate exited 0, redis, web, worker, ws-gateway, nginx, bitcoin-mock, mock-imds, mock-s3)
- worker logs include `[worker] equity-snapshot ready`
- `equity_snapshots` table populated: **55 rows / 56 users** (one fresh signup post-tick; expected)
- screenshots present: `slice-5-portfolio-{admin,fresh,mobile,welcomecard}.png` all under `docs/phases/phase-10-revamp/screenshots/`

## Findings

### Blockers
None.

### Majors
- **M-1** — Live equity excludes margin P&L and lending accrued (see above).

### Minors / Nits
- **M-2** — BalancesTable filters on spot amount only.
- **M-3** — Worker writes $0 snapshots for zero-balance users.
- **M-4** — (verified safe, no action)
- **M-5** — Activity capped at 50 with no "Load more".

## Final verdict and recommendation

**PASS WITH NITS.** Ship it.

The slice delivers exactly what the plan promised: a single-round-trip dashboard, an equity-snapshot worker writing real rows on a 5-min cadence, a welcome card with onboarding state, and six well-scoped components that drop cleanly into the existing exchange UI vocabulary. V-NNN preservation is provable (10 quarantined paths all have empty diffs; V-22 is exercisable end-to-end via the new auth flow). Build, tests, and docker are all green.

M-1 is the only real follow-up worth filing — it's a symmetry bug between the worker's `computeUserEquity` and the API's `liveEquity` accumulator, fixable by extracting the worker function into a shared lib and calling it from both sites. With current seed data (no open margin positions, no accrued lending), no trainee will hit it. As trainees start exercising margin and lending in the platform, the 24h delta number will start lying to them — file as a Phase 11 cleanup or fold into a slice-5.1 fast-follow.

No code changes blocking the commit. No planted vuln was harmed in the making of this slice.
