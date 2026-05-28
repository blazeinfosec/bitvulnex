# QA Fix Summary

**Date:** 2026-05-29
**Engineer:** Staff Engineer (post-QA functional fix pass)
**Stack:** `docker compose up -d`, http://localhost

Triaged the two QA reports (Functional + Paranoid) and applied
minimal, focused fixes for all functional defects. No planted V-NNN
vulnerabilities were touched. The V-42 zero-confirmation tier-3
credit path remains intact (confirmed by verification: 0.5 BTC sent
to a tier-3 deposit address credits with `confirmations=0` before any
block is mined).

## Findings

| ID | Severity | Status | Fix location |
| -- | -------- | ------ | ------------ |
| F-1 | High | FIXED | `apps/web/app/account/trading/[pair]/page.tsx:31-35` |
| F-2 | Critical | FIXED | `apps/worker/src/deposit-watcher.ts:129-142` |
| F-3 | Medium UX | FIXED | `apps/web/components/ui/navbar.tsx:30-36` |
| F-4 | Low UX | FIXED | `apps/web/components/ui/navbar.tsx:60-71` |
| P-1 | Medium | FIXED | `apps/web/app/api/v2/auth/signup/route.ts:46-70` |
| P-3 | Medium | FIXED | `apps/web/app/api/v2/admin/kyc/[userId]/approve/route.ts:20-23` + `.../reject/route.ts:20-23` |
| P-5 | Medium UX | DEFERRED | mobile responsive — see below |
| P-6 | Medium a11y | FIXED | `apps/web/app/signup/page.tsx` (form labels + aria-describedby), `apps/web/app/login/login-form.tsx` (same pattern) |
| P-7 | Low | FIXED | `apps/web/app/api/v2/me/orders/[id]/route.ts:22-23` + `:45-46` (`Number.isSafeInteger`) |
| P-8 | Low | FIXED | `apps/web/app/api/v2/auth/signup/route.ts:27-37` (zod `.max(254)` + local-part refine) |

### F-1 — trading page slug

Hyphenated URL slugs (`/account/trading/BTC-USDT`) are now translated
to API form (`BTC/USDT`) before calling `POST /api/v2/me/orders` and
the public price/book endpoints. URL-encoded slashes
(`/account/trading/BTC%2FUSDT`) still work unchanged.

### F-2 — deposit watcher credits `available`

The deposit-watcher upsert now increments **both** `amount` and
`available` on the `Balance` row. The `amount = available + locked`
invariant (Phase 5 Q-5.4) is preserved at credit time because the
deposit has no associated `locked` quantity. **V-42 (zero-conf
tier-3 credit) is unchanged** — V-42 governs *when* the credit
happens (`minConfirmationsForTier(3) === 0`), the fix governs *where*
the credit lands.

Verified end-to-end with a tier-3 user sending 0.5 BTC; database row
shows `amount=0.5, available=0.5, locked=0` immediately after the
worker tick.

### F-3 / F-4 — navbar gating

- Added a `Trade` link visible only when authenticated, pointing at
  `/account/trading/BTC-USDT` (the post-F-1 canonical slug).
- Hid `Sign in` / `Create account` when authenticated, matching the
  existing pattern used for `Support`.

### P-1 — signup duplicate email maps to 409

Pre-check via `findUnique` still returns 409 in the non-race path.
Added a try/catch around `prisma.user.create` that maps
`Prisma.PrismaClientKnownRequestError` with code `P2002` (unique
constraint) to a 409 response, eliminating the empty-body 500 on
double-click submits.

### P-3 — admin KYC approve/reject 404s

Both `approve` and `reject` now do an explicit `findUnique` on the
user and the kyc profile up-front and return `404 user not found` /
`404 kyc submission not found` instead of bubbling a raw Prisma
exception. Same pattern used by the sibling `balance-adjust` route.

### P-5 — DEFERRED: mobile responsive overflow

Documented for post-ship polish. Reason: the fix touches the global
navbar layout plus the landing-page market-tile grid and the trading
page table; the Tailwind breakpoint changes risk regressing desktop
layouts that the gauntlet of QA passes was happy with. Scoping a
dedicated mobile-responsiveness pass is the right shape for this.

### P-6 — signup + login form labels / aria

Each input now has an `id`, `name`, an associated `<label
htmlFor>`, and `aria-describedby` linking to the error message
container. Error messages have `id` + `role="alert"`. The TOTP code
input in `login-form.tsx` got the same treatment with an
`sr-only` label since the visual placement above the input was
already self-documenting for sighted users.

### P-7 — order id numeric overflow

Replaced `!Number.isInteger(orderId)` with
`!Number.isSafeInteger(orderId) || orderId <= 0` on both `GET` and
`DELETE`, so 21-digit IDs (and zero / negative) fall into the same
400 branch as obvious garbage.

### P-8 — signup email length cap

Added `.max(254)` and a `.refine` on the local-part length (≤64) to
the signup zod schema. A 204-char `+`-laden local-part now returns
`400 validation failed`.

## Verification

| Gate | Result |
| ---- | ------ |
| `pnpm test` | 104/104 pass (28 test files) |
| `pnpm --filter @bvbe/web exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/worker exec tsc --noEmit` | clean |
| `docker compose ps` | 9/9 services up; web + worker recreated |
| F-2 E2E (deposit → balance) | `amount=0.5, available=0.5` confirmed in db |
| P-1 dup signup | 409 `email already in use` |
| P-3 missing user approve/reject | 404 `user not found` |
| P-7 huge int GET/DELETE | 400 `bad id` |
| P-8 long email | 400 `validation failed` |

## Planted V-NNN — explicit no-touch verification

| V-NNN | Surface | State |
| ----- | ------- | ----- |
| V-1 | admin `/admin/users` + `/admin/users/[id]` `dangerouslySetInnerHTML` | intact |
| V-4 | `apps/web/app/api/v2/me/orders/[id]/route.ts` GET/DELETE — no ownership filter | intact (P-7 only changed the id-parse guard) |
| V-42 | `apps/worker/src/deposit-watcher.ts` `minConfirmationsForTier(3) === 0` | intact (F-2 only added the `available` write; the credit-at-0-conf logic is unchanged) |
| Others | not in the diff | intact |

The fix-pass diff scope is restricted to functional + a11y +
input-validation cleanups. No planted vulnerability was modified,
removed, or hardened.
