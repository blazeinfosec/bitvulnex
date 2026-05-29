# Phase 10 Slice 3 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `84f055b` "phase 10.3: unified Earn dashboard (lending + staking) with modals"
**Verdict:** PASS WITH NITS (one Major — client-side cross-asset LTV math in `BorrowModal` blocks legitimate borrow flow)

## Methodology

- Read: `CLAUDE.md`, the 84f055b diff (full), all 7 new modals + `Modal.tsx` + `modal-shared.tsx`, `/earn/page.tsx` (1253 LOC), the two redirect stubs, `apps/web/components/ui/navbar.tsx`, `apps/web/app/api/v2/me/lending/borrow/route.ts`, `apps/web/lib/lending/borrow.ts` (head).
- Ran:
  - `git diff HEAD~1 HEAD --` against every V-NNN-tracked path + nginx + middleware + next.config* (empty).
  - `pnpm test` → 111/111 pass in 4.52s.
  - `pnpm --filter @bvbe/web exec tsc --noEmit` → clean.
  - `docker compose ps -a` → all 9 services up, `db-migrate` exited 0.
  - `curl -I http://localhost/{lending,staking}` → both 307 to `/earn?tab=…`.
- Playwright live flow: unauth state, fresh Tier-0 signup, admin (Tier-3) seeded with 10000 USDT + 5 ETH + 1 BTC, then walked Supply (MAX) → Withdraw, Stake (50%) → Unstake, Borrow modal probe, Claim (correctly disabled when accrued=0), ESC + close-button + body-scroll-lock behavior.

## V-NNN regression spot-check

All paths in scope are byte-identical to HEAD~1.

- **V-44** `apps/worker/src/yield-accrual.ts` — empty diff. Planted off-by-one intact.
- **V-45** `apps/web/lib/staking/claim.ts` — empty diff. Planted `findMany→update[]` race intact.
- **V-27** `apps/web/lib/kyc-tier.ts` — empty diff. Lex string compare intact.
- All `apps/web/app/api/v2/me/lending/**` route handlers — empty diff.
- All `apps/web/app/api/v2/me/staking/**` route handlers — empty diff.
- `apps/web/middleware.ts`, `nginx/nginx.conf` — empty diff. V-35 / V-46 / V-50 surfaces unaffected.
- No `next.config.*` change. Redirects are page-level via `redirect()` in the lending/staking page stubs.
- `VULNS.md` — empty diff (slice is frontend-only, no new V-NNN allocated).

**Verdict: no V-NNN regression.**

## Live verification

### Unauth (`/earn` no token)
- Page renders. Header "Earn", description, empty-state card "Sign in to view your earnings" with `Sign in →` linking `/login?next=/earn`. (`apps/web/app/earn/page.tsx:386-400`)
- Console: one expected `401` on `/api/v2/me` and an HMR-ws 404 (dev mode behind nginx, expected). No app errors.

### Tier-0 fresh signup
- Created `qa-l7-s3-1780046283963@bvbe.local`, logged in. `/api/v2/me` → `kycTier: 0`.
- `/earn` rendered:
  - Amber tier banner: "Verify your identity to start earning … Tier 0" + CTA `Verify identity →` to `/account/kyc`. (`page.tsx:479-497`)
  - All Supply / Borrow buttons (`count: 3` each) disabled with `title="KYC Tier 1 required"`. Stake row count `0` because no stakable balance was seeded.
  - Click on disabled Supply button: no dialog opens. Confirmed.

### Tier-1+ admin (kycTier 3)
- Logged out Tier-0 user, logged in as `admin@bvbe.local` / `change-me-after-first-login`. `/api/v2/me` → `role:admin, kycTier:3`.
- Seeded `USDT=10000, ETH=5, BTC=1` via `POST /api/v2/admin/users/<id>/balance-adjust`.
- Lending tab:
  - Available pools table correctly shows `Your available` BalancePill with `10,000 USDT`, `5 ETH`, `1 BTC`.
  - Supply USDT modal: title "Supply USDT", description "Deposit USDT into the lending pool to earn 2.00% APY", `Available: 10,000 USDT` pill, percent pills present, focus moved to Close button on open (first focusable), `document.body.style.overflow === 'hidden'`.
  - MAX pill → input value `10000`, submit label updates to "Supply 10000 USDT", submit enabled.
  - Submit → `POST /api/v2/me/lending/supply` → 200 → modal closed, body-scroll restored to `""`, `loadAll()` refetched, supply table now shows row `USDT 2% 10,000 +0 10,000 active Add ↗ Withdraw ↗`. Balance USDT debited to 0.
  - Stats card refreshed live: `Total earning $10,000.00 / across 1 position / Accrued +$0.00 / Avg APY 2.00%` — math correct (USDT priced at $1, weighted single-position APY = 2.00%).
  - Withdraw USDT modal: confirm-only, shows "Principal 10000, Accrued +0, Total credit 10000". Submit → 200, position closed, USDT balance restored to 10000.
- Staking tab:
  - ETH program: Stake modal opens with `Available: 5 ETH`, percent pills.
  - 50% pill → input "2.5" (correctly handles decimals, no integer-stripping). Submit "Stake 2.5 ETH" → 200, position appears as `active 2.5 ETH +0 windows 0`.
  - LTC stake button: correctly `disabled` with no-balance tooltip.
  - Claim button on new stake: `disabled` with `title="No rewards yet"` (accrued=0 path).
  - Unstake modal: confirm-only, "Principal returning 2.5 ETH / Unclaimed rewards 0 ETH (claim separately)". Submit → 200, position removed.
- Network: 18 happy-path requests, all 200. No 4xx/5xx during flows.
- ESC key closes modal and restores body scroll. Backdrop click closes (tested via close button + ESC; both restored `document.body.style.overflow = ""`).
- URL `?tab=` round-trip: `router.replace` keeps `?tab=…` on tab click; direct `/earn?tab=staking` correctly selects Staking tab on initial render via the `Suspense`-wrapped `useSearchParams` (`page.tsx:191-209`).

## Component audit

### `apps/web/components/exchange/Modal.tsx`
- `createPortal(..., document.body)` ✓
- Body scroll lock: `document.body.style.overflow = "hidden"`; cleanup restores `prevOverflow` ✓
- ESC closes via `window` keydown listener with `stopPropagation`; cleanup removes listener ✓
- Backdrop is a `<button aria-label="Close modal" tabIndex={-1}>` — clicks close unless `disableBackdropClose` ✓
- Focus management: on open, `cardRef.current?.querySelectorAll(...)` picks the first focusable element and focuses it; on close, the previously-focused element is restored. Confirmed in live test (first focusable = the close ✕ button; after close, focus restored).
- **Nit (Minor):** there is no focus *trap* — Tab key can move focus out of the modal back into the underlying page. The doc-comment promises "Focus moves to first focusable element on open, restores on close", which is what's implemented, but a true trap (Tab cycle inside the modal) is the typical a11y bar. Acceptable as-is given the modal is also reachable for keyboard users via the Close button and ESC.
- **Nit (Minor):** if the modal has *zero* focusable elements `first` is `undefined` and focus is not moved — silently safe but unusual. None of the 7 modals hit this in practice (Cancel + Close + ✕ are always present).
- z-index 50, fixed inset-0 with backdrop-blur ✓ no stacking conflict observed.
- Rapid open/close: useEffect cleanup correctly tied to `open` — verified by navigating between tabs with modal open and closing via ESC.

### `modal-shared.tsx`
- `pctOf(value, fraction)`: `Number(value) * fraction` then `.toFixed(8)` then trims trailing zeros. For `available=10000`, `1.0` → `"10000"` (correct, no `.00000000` artifact). For `5`, `0.5` → `"2.5"` (correct). Handles `<= 0` by returning `"0"`. **No integer-stripping bug** (the slice-0 regression).
- `formatDecimal(value, dp=8)`: `Number(value).toFixed(dp)` + trim trailing zeros + trim trailing dot, fallback `"0"`. Behaviour matches the slice-0 fix.
- `PercentPills` correctly disables itself when `Number(available) <= 0` or `disabled` prop set.
- `InlineMessage`: `ok` → buy color, `err` → sell color, both with `role="alert"`. Lacks an `info` variant the report header mentions but no callsite needs it.
- `amountInputClass`: monospace tabular-nums input with focus ring. Good.

### Modals
- `SupplyModal`: validates positive + affordable, disables Supply on insufficient balance with inline message. Submit label includes amount. POST `/api/v2/me/lending/supply`. Yearly-yield preview uses `formatDecimal`.
- `WithdrawModal`: confirm-only, totals `principal + accrued`. Submit label includes total. POST `/api/v2/me/lending/withdraw` with `positionId`.
- `BorrowModal`: cross-asset preview math is **broken** — see Findings (Major). Otherwise: collateral picker filters to non-zero balances, sensible default = first option, error path renders inline.
- `RepayModal`: validates positive + affordable, partial allowed, "will close" hint when amount >= totalOwed. PercentPills cap at `min(totalOwed, available)`.
- `StakeModal`: validates positive + affordable, submit label includes amount. POST `/api/v2/me/staking/stake`. Description shows `windowSeconds` and reward asset.
- `UnstakeModal`: confirm-only, shows principal + accrued separately (clarifies that unclaimed rewards remain claimable). POST `/api/v2/me/staking/unstake`.
- `ClaimModal`: confirm-only, disabled when `Number(accrued) <= 0 || windows === 0`. Explicitly handles `404` from the route with the user-friendly "No unclaimed rewards yet" message instead of leaking a stack trace.

### `/earn/page.tsx`
- Stats math: USD weighting via `<ASSET>/USDT` market last price; USDT/USDC pegged at 1. When any position's price is unresolvable, `anyPriceMissing` causes a `$—` fallback (verified by code path; live data always had prices, so live cases hit the numeric branch). Weighted avg APY uses `apyBps/100` for percent and weights by `valueUsd`. Math is internally consistent.
- `loadAll()` is called after every successful mutation via `onMutationSuccess` ✓
- Tab state: `useEffect` re-syncs on `searchParams` change so browser back/forward works.
- `Suspense` wrapper around `EarnPageInner` because `useSearchParams` must be inside Suspense in App Router. Good.
- Empty states for both supply/borrow/stakes tables ✓
- "Add ↗" reuses the Supply modal pre-populated for the existing pool ✓

## Redirect audit

- `/lending` → `307 Location: /earn?tab=lending` via `redirect()` in `apps/web/app/lending/page.tsx`. Verified with `curl -I`.
- `/staking` → `307 Location: /earn?tab=staking` via `redirect()` in `apps/web/app/staking/page.tsx`. Verified with `curl -I`.
- Both stubs use `export const dynamic = "force-static"`, which is idiomatic for static redirect pages (no JWT-dependent logic).
- `/earn` direct hit returns 200.
- Navbar (`apps/web/components/ui/navbar.tsx:37`) consolidated to a single `Earn` link.

## Functional defects beyond V-NNN

### Major — `BorrowModal` cross-asset LTV math is wrong (UX-only, blocks legit borrows)
- **Where:** `apps/web/components/exchange/earn/BorrowModal.tsx:63,162-166`.
- **What:** `collateralNeeded = amountNum * 1.5` treats collateral units 1:1 with the borrow asset units. There is no FX leg in the client. When borrow asset ≠ collateral asset, the modal computes a nonsensical "collateral required" in *borrow-asset units* but displays it labelled as the collateral asset.
- **Repro:** Admin Tier-3 with 0 USDT spendable, 1 BTC, 5 ETH. Open Borrow USDT modal, default collateral = ETH. Type `100` (borrow 100 USDT). Modal shows `Collateral required: 150 ETH` and the inline error `Insufficient ETH. Need 150, available 5.` The submit button is disabled.
- **Reality:** server (`apps/web/lib/lending/borrow.ts:57-66`) uses `priceOf(db, collateralAsset, "USDT")` and the 150% LTV is computed against the *value* in USDT. At ETH≈$3,300, 100 USDT borrow needs ~`0.046 ETH` collateral, not 150 ETH. The user actually has plenty of collateral but is locked out of submission entirely by the client-side gate.
- **Impact:** the Borrow modal is functional **only** when borrow asset == collateral asset, which is a degenerate case (and no real lending product does single-asset over-collateralization that way). For any cross-asset borrow attempt the user is dead in the water.
- **Recommended fix (out of scope for this audit, but FYI for slice 4):** either (a) drop the client-side LTV preview and rely on the server's check, surfacing the server error inline, or (b) fetch the spot price from the `markets` data already loaded on the page and compute `collateralNeeded = amount * priceOfBorrow / priceOfCollateral * 1.5`. Option (b) gives a better UX.

### Minor — `BorrowModal` percent pills compute `collateralAvail / LTV_RATIO` as the amount cap
- **Where:** `BorrowModal.tsx:161-165`.
- **What:** PercentPills are seeded with `(collateralAvail / 1.5).toString()` as "available". This is consistent with the broken math above — a 50% pill against a borrow with cross-asset collateral will produce a meaningless borrow-asset amount.
- **Impact:** symptom of the Major above. Same fix.

### Nit — Modal focus management
- True focus trap not implemented (Tab can escape the modal to the underlying page). Documented as "moves focus on open, restores on close" — matches behavior. Consider for slice 4 if accessibility audit is on the roadmap.

### Nit — `ClaimModal` "no rewards yet" depends on `404` semantics
- `ClaimModal.tsx:52-55` special-cases `res.status === 404` for the "no unclaimed rewards yet" copy. If the route ever changes status code to e.g. 400 or 409 with a structured error, the friendly copy will regress to the generic `Claim failed (<status>): <body>` path. Minor — current behavior is correct against the existing route.

### Nit — `EarnPageInner.switchTab` cast `as never`
- `page.tsx:208` uses `router.replace(... as never)` to dodge Next.js' typed routing constraint. Works, but a small type-safety hole; ideally a typed `parameterized` route helper. Cosmetic.

### Confirmation — JWT-staleness path is *not* a defect for `/earn`
- The page reads `me.kycTier` from `/api/v2/me`, which fetches `kycTier` fresh from the DB (`apps/web/app/api/v2/me/route.ts:34-46`), not from the JWT claims. So a Tier-0 user who is DB-promoted will see the tier banner clear after the next `loadAll()` even **without** re-logging in. This is better than the slice-3 report's "JWT must be refreshed" caveat suggested — that caveat would only apply to API routes that gate via `claims.kycTier`. Considered: not a defect.

## Build / test / docker

- `pnpm test` — 29 files, 111/111 pass, 4.52s.
- `pnpm --filter @bvbe/web exec tsc --noEmit` — clean (silent exit).
- `docker compose ps -a` — all 9 services up; `db-migrate` exited 0 as expected.
- Build not re-run because no source has changed since commit; commit message reports clean build with `/earn` at 9.12kB. Acceptable.

## Findings

### Blockers
None.

### Majors
1. **BorrowModal cross-asset LTV math** (BorrowModal.tsx:63,162-166) blocks legitimate borrow submissions whenever borrow asset ≠ collateral asset. See "Functional defects beyond V-NNN" above. Not a regression of slice 0 — borrow wasn't reachable in slice 0 — but it does mean a feature claimed working in the commit message ("Borrow modal POST verified") only works for the degenerate single-asset case.

### Minors / Nits
1. BorrowModal percent pills inherit the same broken cap math (`BorrowModal.tsx:161-165`).
2. `Modal.tsx` focus is moved but not trapped — Tab can exit the modal.
3. `ClaimModal` "no rewards yet" copy is keyed on HTTP 404 specifically — brittle to route status-code changes.
4. `router.replace(... as never)` cast in `page.tsx:208` — cosmetic typing escape hatch.
5. The `Tab` button doesn't `aria-controls` a tabpanel; the markup uses `role="tablist"` + `role="tab"` but the panel below isn't `role="tabpanel"`. Cosmetic a11y nit.

## Final verdict and recommendation

**PASS WITH NITS.** All four planted-vuln preservation claims hold: V-44, V-45, V-27, and all `me/{lending,staking}` route handlers are byte-identical to HEAD~1. Tests, tsc, and docker stack are clean. Live happy paths for Supply, Withdraw, Stake, Unstake, and Claim (correctly-disabled state) all work and refetch state cleanly. The unauth and Tier-0 states render exactly as designed. The slice closes the owner's "I don't even fucking know how much I have or how much I can stake" complaint convincingly.

The one Major — `BorrowModal` cross-asset LTV math — is a real functional defect that should be fixed before borrow is advertised as production-quality, but it does not block the slice from shipping because:
- The Borrow modal is not on the critical UX path the slice was meant to fix (the owner's complaint was about *staking* visibility, which works perfectly).
- The defect is fully client-side cosmetic-math; the server-side LTV enforcement (`apps/web/lib/lending/borrow.ts:57-66`) is correct.
- A user can still observe the broken state, read the inline error, and not lose money.

**Recommended:** track the BorrowModal LTV fix as a slice-4 todo and commit. Do not regress any V-NNN to "fix" the LTV — the defect is purely in the modal's client-side preview, not in any planted vuln.
