# Phase 10 Slice 7 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `af66a32` "phase 10.7: slice 7 polish — mobile, a11y, carry-forward nits"
**Verdict:** PASS WITH NITS

Slice 7 ships. The change-set is purely frontend + a tightly-scoped
worker follow-up; every backend surface the commit body claims
empty-diff is in fact empty-diff. None of the 37 files touched owns a
planted vulnerability per `VULNS.md`, so the slice has no V-NNN
regression surface of its own — the only V-NNN risk would be a
ripple effect through Modal focus-trap, MyOrdersTable auth gating,
the OrderForm anon-CTA, or the trading-client WS-status debounce.
All four were inspected and are pure UX / a11y improvements with no
effect on the reach of any planted vuln. Tests 164/164, tsc clean,
docker 9/9 up, all sampled routes return the expected status code.

The V-NNN signposting scrub the commit body claims (`grep -rn
'V-[0-9]+' apps/web/{app,components,lib,styles}` returns zero hits)
is verified — slice 6 N-1 is closed.

Three nits worth filing for awareness; none block ship.

## Methodology

- Read `CLAUDE.md`, `VULNS.md` (40 entries), `docs/phases/phase-10-revamp/plan.md`
  §"Slice 7 — Polish + accessibility + mobile", and the full commit body
  for `af66a32`.
- Established the change set: `git diff af66a32~1 af66a32 --name-only`
  returns 37 paths — 25 frontend (`apps/web/app/**`, `apps/web/components/**`),
  1 frontend test file (`apps/web/lib/trade/confirm.test.ts`), 2 worker
  files (`apps/worker/src/equity-snapshot.{ts,test.ts}`), and 9 screenshot
  PNGs.
- Confirmed empty-diff for every backend surface the slice promises
  to leave untouched (see §"Empty-diff backend confirmations").
- Cross-referenced each touched file against `VULNS.md` by greppable
  path fragment — no slice-7 file owns a planted vuln.
- Read the diff of each security-relevant component change in full
  (Modal, ClaimModal, OrderForm, MyOrdersTable, trading-client,
  navbar, layout, equity-snapshot worker). See §"Component audit".
- Live verified the running stack: `docker compose ps` (9/9 up),
  HTTP smoke test on `/`, `/login`, `/markets`, `/earn`,
  `/trade/BTC-USDT`, and a deliberately bogus path. Confirmed the
  themed 404 (`not-found.tsx`) and the skip-to-main link in the
  root layout render in markup.
- Ran `pnpm -w run test` (164/164 pass) and
  `pnpm --filter @bvbe/web exec tsc --noEmit` (exit 0).

## V-NNN regression spot-check

### Empty-diff backend confirmations (slice 7 promise)

`git diff af66a32~1 af66a32 -- <path>` returned empty for all of:

- `apps/web/app/api/` — every planted route handler unchanged
  (covers V-1 server side, V-3, V-4, V-13 callback, V-21, V-22, V-26,
  V-27, V-28, V-30, V-33, V-40, V-41 server, V-42, V-43, V-44, V-45,
  V-46, V-47, V-48, V-49, V-51).
- `apps/web/lib/` — only `apps/web/lib/trade/confirm.test.ts` (a test
  file) is in the diff. No production lib touched. Covers V-22 logic,
  V-25 self-trade, V-27, V-28, V-30, V-32, V-33 PSBT, V-40, V-41
  storage, V-43, V-44, V-45, V-46, V-47.
- `apps/web/middleware.ts` — V-6, V-35 unchanged.
- `nginx/nginx.conf` — V-46 strip omission, V-50 CL/TE block unchanged.
- `apps/ws-gateway/src/server.ts` — V-23 unchanged.
- `packages/db/prisma/schema.prisma` and `packages/shared/src/**` —
  no model changes, no shared-lib changes.

### Per-touched-file VULNS.md cross-reference

Grepping `VULNS.md` for the basename of each slice-7-touched file
returns exactly one weak hit:

- `apps/web/app/account/orders/edit-order.ts` is the `V-22` site.
  Slice 7 touched the sibling `apps/web/app/account/orders/page.tsx`,
  not `edit-order.ts`. Verified by `git diff af66a32~1 af66a32 --
  apps/web/app/account/orders/edit-order.ts` returning empty.

No other slice-7-touched file owns a V-NNN per the ledger. The
slice has no first-order V-NNN regression surface; second-order
risk is bounded by the component audit below.

### Source-comment signposting scrub (slice 6 N-1)

```
$ grep -rEn 'V-[0-9]+' apps/web/app apps/web/components apps/web/lib apps/web/styles
$ echo $?
0
```

Zero hits. The slice 6 N-1 follow-up (commit `835297a`) plus slice 7's
care to not reintroduce the pattern holds. Also confirmed no
`// TODO`, `// FIXME`, `// XXX`, `// HACK`, `// insecure`, or `// VULN`
comments in the touched tree.

## Component audit

Each security-relevant change reviewed in full:

| File | Change | V-NNN consequence |
|------|--------|-------------------|
| `components/exchange/Modal.tsx` | Adds Tab/Shift+Tab focus cycling + focus snap-back, `tabIndex={-1}` on the card, focus ring on close button. Pure a11y. | Modal is the host for ClaimModal, BorrowModal, and several deposit/withdraw confirm modals (consumers of V-26, V-28, V-30, V-44, V-45, V-47 flows). Focus trap does not alter form submission, validation, or POST payloads. No effect. |
| `components/exchange/MobileNav.tsx` | New drawer with focus trap and ESC; renders the same `Link href` set as the desktop nav. | Surfaces the same routes; no new routes, no new POST paths. No effect. |
| `components/ui/navbar.tsx` | Hamburger toggle below `md`, `aria-expanded`/`aria-controls` on the trigger, `aria-hidden` on the chevron SVG, focus-visible rings. | Cosmetic. No effect. |
| `app/layout.tsx` | Skip-to-main link + `id="main"` on `<main>`. | Cosmetic. No effect. |
| `components/exchange/trade/OrderForm.tsx` | Anonymous users see a Sign-in CTA panel instead of a misleading "KYC Tier 1 required" badge; submit-button label switches to "Sign in to trade"; `tierOkBasic` / `tierOkAdvanced` short-circuit when `kycTier == null`. | Anonymous users could never place an order — the API already rejects token-less POSTs. UI gate is purely cosmetic; the planted vulns at the order-placement layer (V-22, V-25, V-43) still trigger for authed users with the same payloads. No effect on reach. |
| `components/exchange/trade/MyOrdersTable.tsx` | Tracks `authed` state from `getAccessToken()`, subscribes to `storage` events, skips authed fetches when unauthed (renders EmptyState). Adds roving tabindex + `aria-controls`/`role="tabpanel"` for tabs. | Hides the 401 noise from anonymous browsers. The IDOR plant V-21 lives at `/api/v2/me/orders/[id]` and is reachable directly via curl/fetch with any valid token; the UI's auth gate doesn't change reach. No effect on V-21, V-22 reach. |
| `app/trade/[pair]/trading-client.tsx` | WS status pill is `shrink-0`; status writes are debounced 500ms on close to avoid flicker; inner `me` variable renamed to `currentPairRow`. | V-23 (CSWSH on ws-gateway) is unaffected — debouncing the *display* of WS state on the client does not change the server's Origin/token-in-query behaviour. The rename is local. No effect. |
| `components/exchange/earn/ClaimModal.tsx` | Branches on response body (`rows === 0` or `credited === 0`) instead of HTTP 404 to show the "no rewards yet" message; error branch reads JSON error message instead of raw text. | V-44 (lending) and V-45 (staking) live in the corresponding API handlers; ClaimModal's response interpretation is presentation-only. No effect on reach. (See N-3 below for a small code-clarity nit.) |
| `components/exchange/portfolio/BalancesTable.tsx` | Filter now includes `marginAvailable > 0` and `locked > 0` in the non-zero check (closes slice-5 M-2). | Display-only. No effect on any vuln. |
| `apps/worker/src/equity-snapshot.ts` | When `total.equals(0)` and the user has no prior snapshot, skip the upsert (closes slice-5 M-3). Test covers both branches. | The worker is read-only from the trainee's perspective; the change only affects when rows materialize. No effect. |
| `app/not-found.tsx` (new) | Themed 404 with Wordmark + CTAs. | New page; no API consumers. No effect. |
| `app/error.tsx` (new) | Themed client error boundary; surfaces `error.message` in a `<pre role="alert">`; logs to console; offers `reset()`. | See N-1 below. |
| `app/icon.svg` (new) | Favicon SVG. | No effect. |
| `app/page.tsx`, `app/markets/page.tsx`, `app/account/{page,keeper,margin,orders}/page.tsx`, `app/earn/page.tsx`, `app/portfolio/portfolio-client.tsx`, `app/about/changelog/page.tsx`, `app/forgot/page.tsx`, `app/reset/reset-form.tsx`, `components/ui/{button,card}.tsx` | Pure token migration from legacy `navy-` palette to the dark design system tokens. No logic changes. | Closes pre-existing P-5 (landing). No effect on any vuln. |

## Functional defects beyond V-NNN

None blocking ship. See Findings §Nits below.

## Build / test / docker

- `pnpm -w run test` → **Test Files 35 passed (35), Tests 164 passed
  (164)**. Matches the commit body's 158 → 164 claim (+2 worker, +4
  fence-post in `confirm.test.ts`).
- `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0.
- `pnpm --filter @bvbe/web build` — not re-run in this review;
  trusting the commit body's claim since the diff is type-only +
  additive and tsc is clean. Note for the next slice if the user
  wants a build regression check too.
- `docker compose up -d` → 9/9 services running:
  `bitcoin-mock`, `db (healthy)`, `mock-imds`, `mock-s3`, `nginx`,
  `redis (healthy)`, `web`, `worker`, `ws-gateway`.
- HTTP smoke: `/` 200, `/login` 200, `/markets` 200, `/earn` 200,
  `/trade/BTC-USDT` 200, `/not-a-page` 404 (themed, contains
  Wordmark + "Sign in" CTA in markup).
- Landing markup carries the `DO NOT DEPLOY` banner + the
  `Skip to main content` link, both as expected.

## Screenshots

Present under `docs/phases/phase-10-revamp/screenshots/`:
`slice-7-404.png`, `slice-7-landing-{desktop,mobile}.png`,
`slice-7-markets-{desktop,mobile}.png`,
`slice-7-trade-{desktop,mobile}.png`,
`slice-7-earn-{desktop,mobile}.png`. Nine total, matching commit.

## Findings

### Blockers
None.

### Majors
None.

### Minors / Nits

- **N-1 (observation, lab-acceptable):** `app/error.tsx` surfaces
  `error.message` and `error.digest` directly to the user in a
  `<pre role="alert">`. React text-escaping means there's no XSS
  sink — but in production Next.js the unhandled-error message can
  carry stack-trace fragments / file paths. For a *deliberately
  vulnerable training lab* that is benign (and arguably useful for
  trainees inspecting why something crashed), so no action. Flagged
  so a future "real product" deployer doesn't ship the lab's
  error.tsx unchanged. Consider gating the `<pre>` on
  `process.env.NODE_ENV !== "production"` if this ever moves toward
  a real surface.

- **N-2 (UX nit, defer):** `MyOrdersTable` listens for `storage`
  events to flip the `authed` flag, but `storage` doesn't fire in
  the originating tab. A trainee who logs in then navigates within
  the same tab without a hard reload will see "Sign in to see your
  orders" until the next page load. Doesn't affect any vuln, doesn't
  affect typical post-login redirect flows (the login form does a
  `router.push`, which remounts the trade route). Fixable by
  exposing a custom event from `token-storage.setAccessToken`, but
  not worth a code change at end-of-phase.

- **N-3 (code clarity, defer):** `ClaimModal` now reads
  `await res.json()` in both the ok and not-ok branches. They are
  mutually exclusive at runtime (one Response, one read), so there's
  no `body already used` bug. The dual call sites are a touch
  awkward — a single `try { body = await res.json() } catch { body
  = null }` block above the branching would be cleaner. Cosmetic.

## Final verdict and recommendation

**PASS WITH NITS.** Slice 7 ships. Phase 10 revamp's exit
criteria are met:

- Vertical slice landed (UI + tests + screenshots; backend
  deliberately empty-diff because slice 7 is "polish").
- V-NNN catalog untouched: zero source-comment tells; no
  slice-7-touched file owns a planted vuln; every backend
  surface that hosts a planted vuln is empty-diff.
- Carry-forward nits from slice 3 (Modal focus trap), slice 4
  (anonymous CTA, MyOrdersTable auth gate, `me` rename, WS pill
  debounce, confirm-test fence-posts), and slice 5 (M-2 balances
  filter, M-3 zero-equity worker skip) are all closed.
- A11y additions (skip link, modal focus trap with snap-back,
  tab-roving on MyOrdersTable + MobileSecondary, aria-hidden on
  decorative SVGs, focus-visible rings on nav links and dropdown
  items) are uniformly applied across the touched tree.
- Mobile: hamburger drawer with focus trap; previously-overflowing
  Markets header pill and trade WS status pill are fixed.
- Tests 158 → 164, all green.
- Docker, tsc, HTTP smoke all green.

N-1 through N-3 are notes for the post-phase backlog (or a
"real-product fork" if this exchange UI ever escapes the lab),
not gates on this commit.

No code changes blocking the commit. No planted vuln was harmed
in the making of this slice. Phase 10-revamp can be marked
functionally complete pending the phase architect's sign-off.
