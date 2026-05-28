# Phase 5 fix-up — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-28
**Scope:** commit `2e67d4c phase 5 fix-up: address L7 QA engineering review`
**Verdict:** **PASS WITH NITS**

The prior L7 review (`l7-qa-review.md`) issued 2 blockers, 5 majors, 6
minors/nits. This fix-up closes both blockers, three of the five
majors (the other two were absorbed into the synthetic-borrow design
declaration), and the minors per the addendum's accounting. Re-run
confirms all numbers and zero V-NNN regressions. Phase 6 may proceed.

## Methodology

Read end-to-end:

- `CLAUDE.md` (planted-vuln rule), `VULNS.md` (21 V-NNN entries),
  `docs/phases/phase-5/{plan,architect-review,l7-qa-review,
  adversarial-qa,paranoid-qa}.md`
- Full fix-up diff via `git show 2e67d4c` (16 files,
  +1027/-133)
- Inspected each new/changed file:
  - `apps/web/app/api/v2/me/margin/transfer/route.ts`
  - `apps/web/app/api/v2/me/keeper/register/route.ts`
  - `apps/web/app/api/v2/keeper/liquidations/[id]/claim/route.ts`
    (gate diff only)
  - `apps/web/lib/engine/margin-orchestrator.ts` (Q-5.6 cleanup)
  - `apps/web/lib/engine/margin.ts` (re-export shim)
  - `apps/worker/src/liquidation-watcher.ts` (worker import)
  - `apps/worker/src/liquidation-watcher.test.ts` (new)
  - `packages/shared/src/margin.ts` (new canonical location)
  - `packages/shared/{package.json,src/index.ts}`
  - `packages/db/prisma/migrations/20260601010000_phase_5_fixup/migration.sql`
  - `packages/db/prisma/schema.prisma` (Balance comment +
    `keeperRegisteredAt`)
  - `docs/phases/phase-5/adversarial-qa.md` (addendum)
- Cross-checked the V-NNN catalogue against the list of files
  touched (none of the V-NNN host files are in the changeset).
- Re-ran:
  - `pnpm test` → **49/49 pass** (13 files)
  - `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
  - `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
  - `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
  - `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
  - `pnpm --filter @bvbe/web build` → succeeded end-to-end (new
    routes appear in route table: `/api/v2/me/margin/transfer`,
    `/api/v2/me/keeper/register`).

---

## Findings

### Blockers

(none)

### Majors

(none)

### Minors / Nits

#### F-1: `transfer` does not validate `asset` against `TradingPair` or a quote-asset allow-list

- **Severity:** nit (data hygiene; not a security finding under
  CLAUDE.md rules)
- **Location:**
  `apps/web/app/api/v2/me/margin/transfer/route.ts:31`
  (`asset: z.string().min(1).max(16)`)
- **Issue:** The schema accepts any string up to 16 chars for
  `asset`. The handler then `findUnique`s on
  `userId_asset`. If the user passes a non-existent asset string,
  the handler returns 400 "no balance for asset" — fine. If the
  user passes a *real* asset they own a row in but which isn't
  meaningful as margin collateral (e.g. a non-quote asset added in
  a later phase), they can still shuffle it between buckets.
  Today only `USDT` rows exist in seed data, so the surface is
  empty.
- **Why nit, not major:** No exploit primitive (the balance row
  has to already belong to the caller; can't escalate; can't
  cross-asset). Just a future-proofing gap.
- **Suggested handling:** Phase 6 can pin `asset` to a registry
  lookup if multi-asset margin is introduced. No action needed
  now. Do NOT add tier gating — see Q-5.1 above; the architect's
  position is that `transfer` is infrastructure, not a tier-gated
  trading surface.

#### F-2: New keeper-registration step requires a one-shot DB write before any claim

- **Severity:** nit (process; chain reach impact = zero)
- **Location:**
  `apps/web/app/api/v2/keeper/liquidations/[id]/claim/route.ts:31-38`
- **Issue:** Pre-fix-up, the claim handler accepted any
  authenticated tier-1+ caller. Post-fix-up, the caller must have
  previously POSTed `/api/v2/me/keeper/register` (which sets
  `User.keeperRegisteredAt`). The PoC narrative in
  `adversarial-qa.md` needs an additional preparatory step:
  `POST /api/v2/me/keeper/register` (returns 200 immediately,
  Tier-1+ gate which the attacker already cleared in step 1 of
  the chain) before `POST /api/v2/keeper/liquidations/{id}/claim`.
- **CHAIN C regression?** No. The new gate is `WHERE
  keeperRegisteredAt IS NOT NULL` with a 200 self-promotion
  endpoint. Any authenticated tier-1+ user can register
  themselves; there is no admin approval. The CHANGELOG line
  cited in the route comment ("anyone can register as a keeper")
  is accurate. CHAIN C cost: one extra HTTP call in the attack
  setup.
- **Suggested handling:** Author should add the
  `POST /me/keeper/register` step to the CHAIN C PoC narrative
  in a future doc-tidy pass so the recipe is reproducible
  verbatim. Phase 6 doc task. No code change.

#### F-3: `BalanceSemantics` comment is correct; orchestrator math is now self-consistent with it

- **Severity:** nit (positive observation)
- **Location:** `packages/db/prisma/schema.prisma:144-154`
  (block comment), `apps/web/lib/engine/margin-orchestrator.ts`
  (open/close)
- **Observation:** Per the new comment, `amount = available +
  locked` (spot subtotal, not grand total). `closePosition` does
  not touch `amount` on the owner side; `openPosition` doesn't
  either. The keeper credit side touches both `available` and
  `amount` symmetrically, which is the spot pattern and correct
  under the new contract. The Q-5.4 latent-accounting concern
  from the prior review is therefore resolved by *narrowing the
  invariant*, not by changing math. Acceptable.

#### F-4: `LiquidationDb` type in the worker now permits ergonomic test fakes — but the production `pollLiquidations` still reads `liquidation.findUnique` *and* `liquidation.create` outside any transaction

- **Severity:** nit (pre-existing; not introduced by the fix-up)
- **Location:** `apps/worker/src/liquidation-watcher.ts:54-65`
- **Issue:** Between the `findUnique` (existence check) and the
  `create`, another watcher tick (or a parallel keeper claim that
  inserts a Liquidation? — no, only the watcher creates them, so
  this would have to be a second worker process) could create a
  duplicate. The DB schema has `@@unique([positionId])` on
  `Liquidation` (per phase 5 plan), which makes the duplicate
  `create` throw rather than silently corrupt — but
  `pollLiquidations` will then leak the exception out of its
  loop.
- **Why nit:** Single-worker-process lab; not a real concurrency
  surface; the new tests don't exercise concurrency anyway. Phase
  6 can wrap in a tx if it grows the worker fleet.
- **Suggested handling:** No change. Note for record.

### Regressions of planted vulnerabilities

**(empty)**

Verified each V-NNN that the L7 review listed as touched-or-adjacent
to Phase 5:

| V-NNN | Location | Status |
|---|---|---|
| V-25 (self-trade) | `apps/web/lib/engine/match.ts` | ✅ Intact. Not in changeset. `grep userId === \| taker\.userId \| maker\.userId` → no matches. |
| V-27 (lex tier compare) | `apps/web/lib/kyc-tier.ts` + `apps/web/app/api/v2/me/margin/positions/route.ts:48-52` | ✅ Intact. `requireTier(user, min)` still uses raw `<` on `number \| string`. The new `tierFor(leverage)` helper returning `"1" \| "2" \| "10"` is still the V-27 reach-expansion caller (architect Cond. #1). |
| V-42 (zero-conf tier-3 credit) | `apps/worker/src/deposit-watcher.ts` | ✅ Intact. Not in changeset. |
| V-35 (middleware bypass) | `apps/web/middleware.ts:33` | ✅ Intact. `if (req.headers.get("x-middleware-subrequest")) return NextResponse.next()` still present. Not in changeset. |
| V-23 (CSWSH / no origin) | `apps/ws-gateway/src/server.ts` | ✅ Intact. Not in changeset. |
| V-32 (cancel/match race) | `apps/web/lib/engine/place.ts` | ✅ Intact. Not in changeset. |
| V-22 (mass assignment) | `apps/web/app/account/orders/edit-order.ts` | ✅ Intact. Not in changeset. |
| V-4 (IDOR orders) | `apps/web/app/api/v2/me/orders/[id]/route.ts` | ✅ Intact. Not in changeset. |
| V-43 (fee-tier maker volume) | `apps/web/lib/engine/fees.ts` | ✅ Intact. Not in changeset. |
| V-8/V-9/V-19/V-20/V-21 (JWT family) | `packages/shared/src/jwt-v1.ts`, `apps/web/lib/env.ts` | ✅ Intact. Not in changeset. |
| V-10 (predictable reset token) | `apps/web/app/api/v2/auth/password-reset/request/route.ts` | ✅ Intact. Not in changeset. |
| V-13 (open redirect) | `apps/web/app/login/login-form.tsx` | ✅ Intact. Not in changeset. |
| V-14 (KYC traversal) | `apps/web/app/api/v2/me/kyc/doc/route.ts` | ✅ Intact. Not in changeset. |
| V-24 (BTC address bypass) | `packages/shared/src/btc-address.ts` | ✅ Intact. Not in changeset. (Tests at `packages/shared/src/btc-address.test.ts` still pass — the planted-permissive validator is exercised positively.) |
| V-40 (SSRF) | `apps/web/app/api/v2/me/kyc/import-url/route.ts` | ✅ Intact. Not in changeset. |
| V-41 (polyglot XSS) | upload + admin KYC paths | ✅ Intact. Not in changeset. |

The fix-up touched 16 files. **Zero of those files host a planted
vulnerability.** The two genuinely new endpoints (`transfer`,
`keeper/register`) are infrastructure: `transfer` operates on the
caller's own `userId_asset` slot (no IDOR primitive available),
runs inside `$transaction`, and is gated by the standard
authorization stamp; `keeper/register` is a self-promotion
endpoint by design (the CHANGELOG-line clue cited in the route
comment is the diegetic hint that anyone can register). Neither
weakens any V-NNN; neither adds an unintended vuln.

CHAIN C reach is **unchanged in primitive** (V-25 self-trade still
unfiltered, public-price endpoint still reads from the manipulable
`Trade` tape) and **slightly increased in operability** because
victims can now actually open positions (Q-5.1 was the prerequisite
gap). The narrowed per-incident payoff caveat from Q-5.9 is
correctly documented in the adversarial-qa.md second addendum.

---

## Verification re-run

```
pnpm test
  ✓ 13 test files, 49 passed (49)
  — apps/worker/src/liquidation-watcher.test.ts: 4 tests passed
    (flag at breach / no flag above liq / no double-flag / null-
    price skip — DI seam exercised via in-memory fake)

pnpm --filter @bvbe/shared       exec tsc --noEmit  → clean
pnpm --filter @bvbe/worker       exec tsc --noEmit  → clean
pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit  → clean
pnpm --filter @bvbe/web          exec tsc --noEmit  → clean

pnpm --filter @bvbe/web build
  → succeeded; routes include
      /api/v2/me/margin/transfer
      /api/v2/me/keeper/register
    (both ƒ dynamic, 250 B handler)

OpenAPI registry imports updated:
  apps/web/app/api/openapi.json/route.ts:34-35
    + import "@/app/api/v2/me/margin/transfer/route";
    + import "@/app/api/v2/me/keeper/register/route";

Migration content:
  packages/db/prisma/migrations/20260601010000_phase_5_fixup/
    migration.sql
    1. UPDATE balances SET marginAvailable = amount
       WHERE marginAvailable = 0;   ← Q-5.1 backfill
    2. ALTER TABLE users
       ADD COLUMN "keeperRegisteredAt" TIMESTAMP(3);  ← Q-5.2

Schema delta:
  User.keeperRegisteredAt DateTime?   ✓
  Balance block comment   ✓ (lines 144-154 of schema.prisma)

VULNS.md count: 21 entries; unchanged. Locations match code.
```

---

## Verdict and recommendation

**Green-light Phase 6.** The fix-up does exactly what the addendum
claims: it makes the planned feature actually work end-to-end
(Q-5.1 backfill + transfer endpoint = exit criterion #2 now
achievable), it ships the two missing deliverables verbatim
(Q-5.2: register route + watcher tests), it consolidates the
duplicated margin math into `@bvbe/shared` cleanly (Q-5.3), and
it declares the synthetic-borrow design as intentional in the
orchestrator header (closing Q-5.5/Q-5.6 as documentation rather
than as a behavior change). No planted vulnerability was
weakened; no unintended vulnerability was introduced; no
surface-area was added that should host a planted vuln but
doesn't (per Phase 5 architect allocation, `transfer` and
`keeper/register` are infrastructure). The four nits above
(F-1 through F-4) are forward notes for Phase 6 and do not
block. Trend reverses cleanly back to "Pass with nits."

— L7 QA
