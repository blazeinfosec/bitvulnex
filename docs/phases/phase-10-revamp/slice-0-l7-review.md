# Phase 10 Slice 0 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `ffc3808` "phase 10 slice 0 + docker bring-up fixes"
**Verdict:** **BLOCK** — one user-visible functional defect (`formatAmount`
mangles integer-only balances) in the very surface slice 0 was meant to
fix. Everything else is clean. Planted V-NNN intact.

## Methodology

Read:
- `CLAUDE.md`, `VULNS.md` (full)
- `git show ffc3808 --stat`, full diff
- `apps/web/app/staking/page.tsx`, `apps/web/app/api/v2/me/staking/positions/route.ts`,
  `apps/web/app/api/v2/me/balance/route.ts`
- `apps/web/lib/kyc-tier.ts` (V-27), `apps/web/lib/staking/claim.ts` (V-45)
- `nginx/nginx.conf` (V-50)
- `apps/web/package.json` + `.npmrc` absence (V-49)
- `apps/worker/src/deposit-watcher.ts` (V-42)

Ran live (Playwright against http://localhost):
- Unauthenticated `/staking` empty-state
- Tier-0 fresh signup → tier-gate banner + disabled controls
- Tier-3 admin zero-balance → "no balance" state + deep-links
- Admin `balance-adjust` → seed 1.5 ETH → percent pills + Stake POST → loadAll
- IDOR: fresh user fetching `/api/v2/me/staking/positions` → empty
- Auth probes against new endpoint: no header, empty Bearer, garbage, `alg=none`
- Reproduced `formatAmount` defect via integer-only `50 LTC` balance

Ran in repo: `pnpm test` (104/104), `pnpm --filter @bvbe/web exec tsc --noEmit`
(clean), `pnpm --filter @bvbe/web build` (clean), `docker compose ps -a`.

## Slice 0 UX verification

### Unauthenticated state — PASS
`/staking` shows "Sign in to stake assets and earn APY" with `Sign in →`
linking to `/login?next=/staking`. No leaked auth state.

### Tier-0 state — PASS
Fresh signup, navigate `/staking`:
- Amber tier-gate `Card` renders: *"Verify your identity to start staking …
  Your account is currently Tier 0. Staking requires KYC Tier 1+."*
- "Verify identity →" links to `/account/kyc`
- Amount `<input>` disabled, all four percent pills disabled, `Stake` button
  disabled
- `Stake` `title` attribute reads exactly `"KYC Tier 1 required to stake"`
- Helper text below form: *"Complete KYC Tier 1 to enable staking."*

### Tier-3 admin state (zero balance) — PASS
Login as `admin@bvbe.local`, zero balances:
- No tier-gate banner (correct — admin is Tier 3)
- "Available programs" table includes `Your available` column showing `0`
  for ETH and LTC
- Stake card shows `Available: 0 ETH`
- All four percent pills disabled (`stakableNum <= 0` branch)
- `Stake` button disabled, `title` =
  `"No ETH available. Deposit ETH or buy on the spot market first."`
- Helper text inline below the Stake card contains working `<a href>` links
  to `/account/deposit` and `/account/trading/BTC-USDT`

### Tier-3 admin state (with balance) — PASS happy-path / fails on display
Seeded `1.5 ETH`. Reload:
- `Available: 1.5 ETH` rendered correctly
- Percent pills enabled
- Click `25%` → input becomes `0.375`
- `Stake` button enabled, `title` = `"Stake 0.375 ETH"`
- Click `Stake` → 200; balance 1.5 → 1.125 ETH; new position id
  `cmpql77nt000hz9l61e6oihds`, principal `0.375`, status `active`
- "Your positions" card refreshes via `loadAll` and lists the new row

Happy-path end-to-end is green. **The display formatting fails for integer-
only balances** — see "Functional defects".

## API audit

### `/api/v2/me/staking/positions` (NEW) — clean

`apps/web/app/api/v2/me/staking/positions/route.ts:22-51`.

- Auth: `userFromAuthorization` → 401 on missing/garbage/`alg=none`/empty Bearer
  (verified live: 4× 401)
- IDOR: `findMany({ where: { userId: claims.sub, status: { in: ["active",
  "unstaking"] } } })` correctly scoped; aggregate per `positionId` is
  derived from a positionId the route just verified is the caller's. No path
  parameter — no crafted-id surface.
- Data exposure: only returns `id, asset, principal, status, startedAt,
  unstakedAt, accrued, accruedWindows`. No other users' ids, no `userId`,
  no internal-only fields.
- DoS via crafted positionId: not applicable — there is no input.
- N+1: yes — `positions.map(async p => prisma.stakingClaim.aggregate(...))`
  is sequential per-position. Real concern only if a single user accumulates
  many positions; the current design caps at "active|unstaking" so growth is
  bounded by user action. **Minor / not a blocker.** Could be rewritten as a
  single `groupBy` if it becomes hot.

### `/api/v2/me/balance` widening — clean

`apps/web/app/api/v2/me/balance/route.ts:23-45`.

The new columns (`available, locked, marginAvailable, marginBorrowed`) are
all already user-owned data the caller controls and observes elsewhere
(`apps/web/app/api/v2/me/margin/transfer/route.ts` reads/writes them on
behalf of the same caller). No cross-user leakage; no internal-only state.
No issue.

## Regressions of planted V-NNN — none

- **V-27 (`apps/web/lib/kyc-tier.ts:50-57`):** unchanged. `requireTier` still
  typed `(user: { kycTier: number | string }, min: number | string)` and
  compares with `<`. Slice 0 staking page calls `me.kycTier >= 1` against a
  *typed* `number` from the typed `Me`; staking POST routes still call
  `requireTier(claims, 1)` (verified by Grep), keeping the latent plant in
  the multi-digit-tier sphere. Intact.
- **V-45 (`apps/web/lib/staking/claim.ts:32-46`):** unchanged. The
  `db.stakingClaim.findMany({ claimedAt: null })` → loop of unconditional
  `db.stakingClaim.update({ where: { id }, data: { claimedAt: now } })`
  *without* a `$transaction` wrapper and *without* a `claimedAt: null`
  predicate on the update remains exactly as planted. The new positions
  endpoint reads `claimedAt: null` rows only for *display* and never writes
  — does not interact with the race window.
- **V-50 (`nginx/nginx.conf:35-36`):** directives **present and functional**
  after the scope move. `ignore_invalid_headers off;` and
  `underscores_in_headers on;` sit in the `server { ... }` block (lines
  35–36), which is valid per nginx docs (both directives accept `server`
  context). `proxy_pass_request_headers on;` remains in `location /` (line
  76). The plant requires the headers to *reach* the upstream, which they
  do — the smuggling primitive is unchanged. The `OPS-2024-117` comment and
  the matching `NODE_OPTIONS=--insecure-http-parser` env in
  `docker-compose.yml` are still present. nginx now actually starts (the
  prior `location`-scope placement was rejected as a grammar error). Intact.
- **V-49 (`apps/web/package.json:optionalDependencies` +
  no root `.npmrc`):** `@bvbe-internal/observability ^0.1.0` still declared
  as `optionalDependencies` (lines verified via `grep`). No `.npmrc` at repo
  root or in `apps/web/`. The Dockerfile change (`--frozen-lockfile`
  removal) was the *correct* response to the V-49 plant — keeping the
  plant intact while letting Docker actually build. Intact.
- **V-42 (`apps/worker/src/deposit-watcher.ts:31, 52`):** untouched —
  `minConfirmationsForTier(3) === 0` zero-conf branch present, no
  reconciliation worker added. Intact.

No planted-vuln behavior regressed. No accidental "polish" patches.

## Functional defects

### F-1 (BLOCKER) — `formatAmount` strips trailing zeros from integer balances

**Location:** `apps/web/app/staking/page.tsx:46-49`.

```ts
function formatAmount(value: string, asset: string): string {
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
```

The regex `/\.?0+$/` matches trailing zeros with an *optional* leading dot,
so it strips the `0`s from any value that ends in `0` even when there is no
decimal point. Backend `Prisma.Decimal.toString()` returns clean integers
without a trailing `.0` (e.g. `"50"`, `"100"`, `"10"`), so this triggers
for any user whose available balance is a whole-number.

**Live repro (admin@bvbe.local, seeded `+50` LTC):**

| API value (`/api/v2/me/balance`) | Page displays                |
|---|---|
| `"50"` (LTC `available`)         | `5 LTC` (Available label + programs `Your available` cell) |
| `"100"`                          | `1`                          |
| `"10"`                           | `1`                          |
| `"1.5"`                          | `1.5` (correct)              |
| `"0.10"`                         | `0.1` (correct intent)       |

Browser console verification at `js:`
```js
const f = v => { const t = v.replace(/\.?0+$/, ""); return t===""||t==="-"?"0":t; };
f("50") === "5"     // <- the bug
f("100") === "1"
```

Same helper drives:
- "Your positions" → `principal`, `accrued` cells (line 292, 294)
- "Available programs" → `Your available` column (line 356)
- Stake card → `Available: ${formatAmount(stakable, asset)} ${asset}` (387)
- Tooltip for the per-row Claim button (305)
- Tooltips on Stake button for the "insufficient" branch (425)
- Helper text "Amount exceeds available balance" (453)

This **directly reintroduces the owner's complaint**: "I don't even fucking
know how much I have." A user holding 50 LTC will see `5 LTC` advertised
across the staking page, including in the Stake card the slice was
expressly designed to clarify.

`pctOf` (lines 51-55) has the same regex but is invoked on
`(n * fraction).toFixed(8)` output, which always contains a decimal point;
that call site is safe. The fix is scoped to `formatAmount`.

**Suggested fix (one line):** require the `0+$` strip to be guarded by a
prior `.`:

```ts
const trimmed = value.includes(".") ? value.replace(/\.?0+$/, "") : value;
```

Or use the standard idiom that only trims after a decimal point:

```ts
const trimmed = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
```

This is a small, well-scoped change — but I'm calling it BLOCKER because it
defeats the entire user-facing intent of slice 0 the moment a user has an
integer balance, which is the most common balance shape for staking-eligible
assets like ETH/LTC when seeded by ops or arriving from a round-number
internal transfer.

### F-2 (MINOR) — `pctOf` MAX precision

`pctOf(value, 1)` calls `(n * 1).toFixed(8)`, then strips trailing zeros.
For balances with more than 8 decimal places this silently truncates and
the user cannot stake their full balance (the truncated value will be
`<= stakableNum` so passes the affordability check, but is strictly less
than `available`). Not blocking — Prisma `Decimal` precision in the seed
data is ≤ 8 places — but worth noting for the design-system slice when MAX
should mean MAX. Trivial fix: pass the raw `value` straight through for
fraction `=== 1`.

### F-3 (MINOR / accepted) — locale parsing of `Number("1,5")`

`Number(amount)` returns `NaN` for comma-decimal input. The page handles
this correctly via `amountValid` (`Number.isFinite(amountNum) && amountNum > 0`)
which gates `canStake`. Disabled `Stake` button + tooltip "Enter an amount"
is the observed behavior. Acceptable — no defect.

### F-4 (NIT) — Race between `stake()` and `loadAll`

After `stake()` calls `await loadAll()` it sets `busy = false`. If the user
immediately clicks Claim/Unstake during the network round-trip they're
already guarded by per-button `disabled={busy || ...}` — no double-submit
window. Acceptable.

### F-5 (NIT) — Error mapping

`stake()` maps 403 explicitly and falls through to a verbose
`Stake failed (${status}): ${body}` for everything else. 400 / 422 / 500
all render as raw status + body text. Adequate for a lab; could be polished
in a later slice. Not a defect.

### F-6 (NIT) — N+1 in positions endpoint

See API audit. Bounded by user activity, not a blocker.

### F-7 (verified, not a defect) — `/account/trading/BTC-USDT` deep-link

The route exists and loads (the staking-page link is reachable). No 404.

## Build/test re-verification

```
$ pnpm test
Test Files  28 passed (28)
Tests       104 passed (104)
Duration    3.99s

$ pnpm --filter @bvbe/web exec tsc --noEmit
(no output — clean)

$ pnpm --filter @bvbe/web build
✓ Compiled successfully
Route /staking  4.95 kB  117 kB First Load JS
```

## Docker stack health

```
$ docker compose ps -a
bitcoin-mock   Up 9 hours
db             Up 9 hours (healthy)
db-migrate     Exited (0) 9 hours ago      [expected — one-shot]
mock-imds      Up 9 hours
mock-s3        Up 9 hours
nginx          Up 9 hours  0.0.0.0:80->80/tcp
redis          Up 9 hours (healthy)
web            Up 8 hours
worker         Up 9 hours
ws-gateway     Up 9 hours
```

10/10 services as expected.

## Final verdict and recommendation

**BLOCK on F-1.**

Slice 0's stated reason for existence is to make balance and stakability
obvious. The new `formatAmount` helper silently mis-displays integer
balances across six call sites on the same page, including the Stake card
that the owner specifically called out. This is a real functional defect
introduced by `ffc3808`, not a planted vuln, and not subject to the
"do-not-fix" rule.

Recommended fix: gate the trailing-zero strip on the presence of a
decimal point (one-line change in `apps/web/app/staking/page.tsx:46-49`),
add a unit test covering integer and trailing-zero cases, re-run Playwright
against an integer-balance account.

Everything else — planted V-NNN preservation, API auth/IDOR shape on the
new endpoint, balance widening, build/test/docker — is clean. After F-1 is
fixed, slice 0 ships.
