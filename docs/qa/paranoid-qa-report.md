# Paranoid QA Report

**QA:** Paranoid (QA-1)
**Date:** 2026-05-29
**Stack:** `docker compose up -d`, http://localhost
**Verdict:** PASS WITH NITS

Three real functional defects (P-1, P-3, P-7), one mobile responsive
gap (P-5), one a11y violation (P-6), and one input-validation
data-quality nit (P-8). All previously reported defects (F-1..F-4)
still hold and were not re-litigated. The lab-safety surface is clean:
DO NOT DEPLOY banners are present on every page tested (20/20),
mock-imds returns the canonical AWS-docs synthetic key
`AKIAIOSFODNN7EXAMPLE`, and `/api/v1/internal/users` returns
synthetic accounts only (no real PII). Planted V-NNN findings were
encountered and ignored.

## Findings (functional defects only — V-NNN ignored)

### P-1: `POST /api/v2/auth/signup` returns 500 on duplicate email instead of 409

- **Severity:** Medium
- **Type:** Functional defect (not in VULNS.md)
- **Repro:**
  1. Open `/signup`, fill `qa-paranoid-1780006837@bvbe.local` + valid
     name + password.
  2. Double-click the "Create account" button.
  3. The first request returns 200 and logs the user in; the second
     hits the duplicate-email path.
- **Expected:** Second request returns `409 Conflict` (or similar
  4xx) with `{error:{message:"email already in use"}}`. Idempotent
  / user-friendly. UI should also debounce / disable the button on
  submit to prevent double-submit at the client.
- **Actual:** `POST /api/v2/auth/signup` second attempt returns **500
  Internal Server Error** with **empty response body**. The browser
  silently swallows it because the navigation succeeded on the first
  call.
- **Evidence:** `browser_network_requests` after double-click shows
  request 12 → 200 OK, request 13 → 500 Internal Server Error,
  empty response body. Network details captured (response headers
  show `transfer-encoding: chunked`, no JSON payload). Likely root
  cause: the handler hits a uniqueness constraint violation in
  Prisma (`P2002`) and re-raises without mapping to 409. The fact
  that the body is empty (rather than `{error:...}`) also points at
  an uncaught throw above the global JSON error middleware.
- **Reachability:** Any user double-clicks submit, or any legitimate
  user retries signup with an email already used.
- **Fix sketch:** Catch the `P2002` (unique constraint) Prisma error
  in `apps/web/app/api/v2/auth/signup/route.ts` and return
  `409 Conflict`. Add a `disabled` state to the submit button on the
  signup form's `useFormStatus()` for client-side double-submit
  prevention.

### P-3: `POST /api/v2/admin/kyc/{userId}/approve` returns 500 (empty body) for missing user / missing KYC submission

- **Severity:** Medium
- **Type:** Functional defect (not in VULNS.md). Phase-9 housekeeping
  documented the analogous fix for `balance-adjust`; the same pattern
  was not applied to `kyc/approve`.
- **Repro:**
  1. Authenticate as admin (`admin@bvbe.local` /
     `change-me-after-first-login`).
  2. `POST /api/v2/admin/kyc/nonexistent-userid-12345/approve` with
     body `{"tier":2}`.
  3. Compare with `POST /api/v2/admin/users/nonexistent-userid-12345/balance-adjust`
     with a valid asset/delta — the balance-adjust path returns
     `404 {error:{message:"user not found"}}`, which is the
     correctly fixed shape.
- **Expected:** `404 Not Found` with
  `{error:{message:"user not found"}}` (or
  `{message:"kyc submission not found"}` for a user that exists
  but has no submission).
- **Actual:** `500 Internal Server Error` with **empty response
  body**. Same shape was reproduced against the freshly-signed-up
  QA user who had no KYC profile submitted yet (the user exists,
  but no kyc submission row exists → the handler crashes instead
  of returning a clean 404).
- **Evidence:** Two probes in one batch — `nonexistent-userid` and
  the QA user with no kyc submission — both returned `{status:500,
  body:""}`. The sibling `balance-adjust` endpoint returns the
  correct 404 in the same batch.
- **Reachability:** Any admin user trying to approve a KYC record
  that doesn't yet exist (typo in userId, or admin clicked too
  early), or hitting the endpoint via the admin UI before the user
  submits their docs.
- **Fix sketch:** In `apps/web/app/api/v2/admin/kyc/[userId]/approve/route.ts`,
  wrap the lookup in the same pattern used by
  `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts:38-46`:
  `findUnique` the user (404 if missing), then `findFirst` the
  kyc submission row (404 if missing), then proceed. Also map any
  raw error path to a 4xx/5xx with JSON body via the global error
  middleware so the empty-body shape doesn't recur.

### P-7: `GET`/`DELETE /api/v2/me/orders/{huge-int}` returns 500 (empty body) on numeric overflow

- **Severity:** Low (defensive)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:**
  1. Authenticate as any user.
  2. `GET /api/v2/me/orders/999999999999999999999` (21-digit value
     well beyond Int32/safe-integer range).
  3. Same with `DELETE /api/v2/me/orders/999999999999999999999`.
- **Expected:** `400 Bad Request` with
  `{error:{message:"bad id"}}` — exactly what the same handler
  returns for `/api/v2/me/orders/1; DROP TABLE` (URL-encoded).
- **Actual:** `500 Internal Server Error` with empty body. Likely
  root cause: the parse uses `parseInt`/`Number` which succeeds in
  returning a number, then Prisma rejects the value when the schema
  expects an `Int` (`PrismaClientValidationError` or equivalent).
  The route returns the right shape for the obvious garbage
  (`bad id`) but not for the silent overflow.
- **Evidence:** In a sweep of ~28 boundary probes (`GET`, `DELETE`,
  `POST` across orders, signup, login, withdrawals, tickets, p2p,
  otc, lending, staking), the **only** 500 cases were P-1, P-3, and
  P-7 (and one expected 414 from nginx for an oversized URL).
- **Fix sketch:** In
  `apps/web/app/api/v2/me/orders/[id]/route.ts`, replace the id
  parse with a guard like
  `const id = Number(params.id); if (!Number.isSafeInteger(id) || id <= 0) return badId();`
  so the overflow path falls into the same 400 branch as the
  `1; DROP TABLE` path.

### P-5: Landing page (and trading page) overflow horizontally at 375×667 (iPhone SE viewport)

- **Severity:** Medium (mobile UX)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:**
  1. Resize viewport to 375×667.
  2. Navigate to `/`. Also reproduce at `/account/trading/BTC%2FUSDT`.
  3. `document.documentElement.scrollWidth` is 973px on a 375px
     viewport.
- **Expected:** Layout reflows for mobile (nav collapses to a
  hamburger or wraps, content stays within viewport). No horizontal
  scrollbar.
- **Actual:** The top navbar's 12 items lay out in one row (width
  ~837px) and overflow the right edge of a 375px viewport. The
  landing page hero copy and market-tile grid don't reflow. User
  must horizontally scroll to see nav items past "Lending."
- **Evidence:** `paranoid-mobile-landing.png` screenshot;
  `{ scrollW: 973, viewW: 375, overflow: true }` measurement.
- **Fix sketch:** Add a mobile-breakpoint media query to
  `apps/web/app/components/site-nav.tsx` (or wherever the navbar
  lives) that collapses the nav into a `<details>` / hamburger
  pattern below 768px. Tailwind `md:flex hidden` on the desktop
  nav block + `md:hidden flex` on a hamburger trigger is the
  minimum-touch fix.

### P-6: Signup form inputs have no `<label>`, `aria-label`, or `aria-describedby`

- **Severity:** Medium (accessibility)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:** Open `/signup`, inspect the three `<input>` elements.
- **Expected:** Each input has either an associated `<label
  for="...">`, an `aria-label`, or `aria-labelledby`. Screen readers
  read the field name to the user.
- **Actual:** All three inputs (email, display name, password) have
  no `id`, no `name`, no `aria-label`, no `aria-labelledby`, no
  `aria-describedby`. The only field identification is the
  `placeholder`, which most screen readers do not read in form
  contexts. The button text and tab order are fine; only the input
  labelling is the gap.
- **Evidence:** `document.querySelectorAll('input')` snapshot dump
  shows
  `{ id:"", name:"", ariaLabel:null, ariaLabelledBy:null,
  ariaDescribedBy:null, hasLabel:false, ... }` for each input.
- **Fix sketch:** In `apps/web/app/signup/signup-form.tsx`, give
  each input an `id` and pair with a `<label
  htmlFor={id}>email</label>` above (or use a visually-hidden label
  + the same `aria-labelledby`). When validation fires, set
  `aria-describedby={errorId}` and render the error in
  `<p id={errorId} role="alert">`. Same pattern needs verifying on
  `/login` and the KYC profile/document forms.

### P-8: `POST /api/v2/auth/signup` accepts a 204-character email with no max-length cap

- **Severity:** Low (data quality)
- **Type:** Functional defect (not in VULNS.md)
- **Repro:** `POST /api/v2/auth/signup` with body
  `{"email":"e+e+e+e+...@b.co"}` (a 204-char `+`-laden local-part
  plus `@b.co`). The current run accepted the address as valid and
  created the user (200 + JWT).
- **Expected:** Reject with `400 validation failed` if the email
  exceeds RFC 5321 §4.5.3.1.1 max (254 chars total, 64 chars
  local-part). The current schema only checks for "an `@`
  somewhere" and uses Zod's default `.email()` shape.
- **Actual:** 200 OK; the user was persisted in the database
  (`/api/v1/internal/users` showed the row); subsequent login with
  the same email works.
- **Evidence:** Probe in the same boundary sweep; the `e+` × 100
  email accepted with a fresh user id
  (`cmpq2byu0003i9w1qg0dak4kf`).
- **Fix sketch:** In
  `apps/web/app/api/v2/auth/signup/route.ts` (and any sibling that
  accepts emails), add `.max(254)` and a `.refine(addr =>
  addr.split('@')[0].length <= 64)` to the Zod schema.

## Console / network observations

Across all paranoid probes the only persistent console error is the
expected Next.js dev-HMR WebSocket 404 (`ws://localhost/_next/webpack-hmr`)
— previously documented by Functional QA and not actionable in the
Docker stack.

No uncaught JS errors. No React hydration warnings. No
`validateDOMNesting` warnings. No 4xx that wasn't a deliberate
boundary probe.

5xx incidents observed during the run:

| Endpoint | Trigger | Response | Maps to |
| - | - | - | - |
| `POST /api/v2/auth/signup` | duplicate email (double-click) | 500 + empty body | P-1 |
| `POST /api/v2/admin/kyc/{id}/approve` | missing user **or** missing kyc submission | 500 + empty body | P-3 |
| `GET /api/v2/me/orders/{huge-int}` | 21-digit overflow | 500 + empty body | P-7 |
| `DELETE /api/v2/me/orders/{huge-int}` | 21-digit overflow | 500 + empty body | P-7 |

All other 5xx-equivalent responses encountered were nginx-level 414
(URI too long) for a 10K-char path, which is correct behaviour at
the edge.

Other anonymous-deep-link observation:

- Hitting `/account/trading/BTC%2FUSDT` while signed-out
  briefly **renders the full protected-page shell** (visible "Order
  book", "Place buy limit", "My open orders" content) before the
  client-side auth check redirects to `/login`. The redirect is
  graceful — no 5xx, no hang — but the protected layout flashes for
  ~200ms first. Cosmetic only; not promoted to a numbered finding.

## Accessibility observations

| Surface | Finding |
| - | - |
| `/signup` form | No labels / no aria — see P-6 |
| `/login` form (sampled) | Same pattern as `/signup` — likely same gap; recommend explicit re-audit when P-6 is fixed |
| Tab order on `/signup` | Correct — header nav → email → name → password → submit → footer. No tab traps. |
| Banner `<alert>` roles | `DO NOT DEPLOY` banners use `role="alert"` correctly; visible content matches the announced text. |
| Color contrast | Not formally measured; sampled the landing page hero and the admin tables visually — no obvious low-contrast issue, but a proper Lighthouse run is recommended before any external user-facing release. (For a lab, this is non-blocking.) |
| Mobile viewport overflow | See P-5 — keyboard-only mobile users would have a real navigation problem. |

## Lab-safety re-verification

| Check | Result |
| - | - |
| `DO NOT DEPLOY` banner on every page | PASS — 20/20 pages tested have 4 banner occurrences each (top alert + footer alert in both `<noscript>` and live versions) |
| `mock-imds` returns synthetic AWS key | PASS — `wget http://mock-imds/.../bvbe-web-instance-role` from inside the docker network returns `AKIAIOSFODNN7EXAMPLE` + `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` (the canonical AWS-docs example credentials) |
| `/api/v1/internal/users` (V-6 path) returns synthetic data only | PASS — the dump contains `qa-paranoid-...@bvbe.local`, `qa-functional-...@bvbe.local`, `admin@bvbe.local`, and synthetic seed users (`first.last.N@example.test`). All scrypt password hashes. No real names, no real emails, no real PII. |
| No real Bitcoin mainnet paths reachable | Not directly probed in this run; mock node still runs on the regtest port (`bitcoin-mock-1:18443/tcp`), and no `mainnet`/`testnet` config in `docker-compose.yml`. |
| `docker-compose down -v` self-contained | Out of scope for live QA but no external network dependencies observed in the request graph. |

Lab-safety: clean.

## Informational (planted V-NNN, ignore)

Touched during the run (no code change):

- **V-6** (`x-bvbe-internal-trace`) — used to dump
  `/api/v1/internal/users` for the lab-safety check. Behaviour
  matches plant.
- **V-13** (open redirect on `?next=`) — not exercised offensively
  this run; the surface remains as documented.
- **V-21** (refresh tokens not single-use) — not exercised this run.
- **V-25 / V-42 / V-46 / V-27** — referenced for context only.

None fixed. None promoted to a numbered finding.

## Final verdict

**PASS WITH NITS.**

The lab is end-to-end functional and lab-safe. The Paranoid sweep
adds three real server-side 500s with empty bodies that a real-team
QA would never ship (P-1, P-3, P-7 — all in handler error-mapping
paths and trivially fixable), one mobile layout regression that
makes the home page unusable below 768px (P-5), one accessibility
gap on the most-traversed form (P-6), and one defensive
input-validation gap that lets a 204-char email through signup
(P-8). None map to any planted V-NNN. All four previously-reported
defects (F-1..F-4) still hold; nothing in this sweep changes the
ship/no-ship decision on those. Recommend fixing P-1, P-3, P-7 as
trivial error-mapping cleanups (and they kill the only `500 + empty
body` shapes left in the API surface — a stable lab characteristic
worth holding); P-5 and P-6 are quality-of-experience nits that an
instructor walking new trainees through the lab will hit on day
one. P-8 is defence-in-depth only.
