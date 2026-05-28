# Phase 5 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer (same role as prior reviews).
> Scope: engineering quality only. Security flaws tracked in
> `VULNS.md` (V-NNN-identified) are intentional and out of scope per
> `CLAUDE.md` § "DO NOT FIX SECURITY ISSUES".
> Commit: `cbc67a6 phase 5: margin trading & liquidation -- CHAIN C completes`
> Date: 2026-05-28
> Verdict: **Block** (2 blockers, 5 majors, 4 minors, 2 nits).
>   Margin engine cannot deliver Phase-5 exit criterion #2 ("Tier-1+
>   user can open a long or short position via the UI") as built —
>   collateral has no funding path. CHAIN C math is internally
>   correct but the documented end-to-end PoC has never been
>   exercised against the deployed HTTP stack.

## Method

Read the Phase-5 commit end-to-end: schema delta + migration
(`packages/db/prisma/schema.prisma`,
`packages/db/prisma/migrations/20260601000000_phase_5_margin/migration.sql`),
the margin engine and orchestrator
(`apps/web/lib/engine/{margin,margin-orchestrator}.ts`), the
worker liquidation watcher and its wiring
(`apps/worker/src/{liquidation-watcher,index}.ts`), the margin
and keeper API surfaces
(`apps/web/app/api/v2/me/margin/positions/{route,[id]/route}.ts`,
`apps/web/app/api/v2/keeper/liquidations/{route,[id]/claim/route}.ts`),
the two new UI pages
(`apps/web/app/account/{margin,keeper}/page.tsx`),
the Phase-4 deferred `apps/web/lib/engine/place.test.ts`, the
new `apps/web/lib/engine/margin.test.ts`, and the existing
`apps/web/app/api/v2/public/price/[pair]/route.ts` (CHAIN C
oracle). Walked the open-position → liquidation → keeper-claim
balance flow on paper with `Prisma.Decimal` semantics. Spot-
checked V-25 (`apps/web/lib/engine/match.ts` — no self-match
filter) and V-27 (`apps/web/lib/kyc-tier.ts:54` — `<` on
`number | string`) for intactness and reach expansion.

---

## Findings

### Q-5.1: `marginAvailable` has no funding path — Tier-1+ user CANNOT open a position via the UI
- **Severity:** **blocker** (functional; exit criterion #2 unmet)
- **Location:**
  - `packages/db/prisma/migrations/20260601000000_phase_5_margin/migration.sql:6-8` (`ADD COLUMN "marginAvailable" DECIMAL(38,8) NOT NULL DEFAULT 0`)
  - `apps/web/lib/engine/margin-orchestrator.ts:67` (`if (!bal || bal.marginAvailable.lt(collateral)) throw ...`)
  - Grep for `marginAvailable` across `apps/`: exactly two hits — the gate and the increment in `margin-orchestrator.ts`. No deposit handler, no transfer endpoint, no admin tool, no UI control credits it.
- **Issue:** The migration adds `marginAvailable` and `marginBorrowed`
  with `DEFAULT 0`. No backfill from `available`. No write path
  exists anywhere in the codebase that moves balance from
  `available` → `marginAvailable`. `openPosition` reads
  `bal.marginAvailable.lt(collateral)` and throws "insufficient
  margin available" for any non-zero collateral. The UI form on
  `/account/margin` posts `{pair,side,size,leverage}`, the API
  returns 400, message renders "insufficient margin available."
  **Every margin open via the documented UI path is dead on
  arrival.**
- **Why this matters:** Phase-5 plan exit criterion #2 reads
  *"Tier-1+ user can open a long or short position via the UI."*
  Paranoid QA marked this met without actually running the flow.
  The adversarial-qa.md PoC sidesteps the entire issue because it
  describes the *attacker chain* (which doesn't require the
  attacker to ever open a margin position — the victim does, and
  the doc handwaves "Assume any other user opens"). There is no
  victim today. CHAIN C therefore has a missing prerequisite —
  no organic margin positions can exist.
- **Compare to plan.md line 89 ("Phase-5 plan — Settlement: …
  Collateral is locked from `Balance.marginAvailable`.").** The
  intent was clearly that this column be funded somehow. The
  implementation simply skipped the funding step.
- **Note re: planted-vulns rule:** this is NOT a security
  finding. The pure-functional bug is "the feature doesn't work,"
  not "the feature is too lenient." Fixing it does not weaken any
  V-NNN.
- **Suggested fix (functional):** Either (a) backfill in the
  migration: `UPDATE "balances" SET "marginAvailable" = "amount"`,
  or (b) ship a `POST /api/v2/me/margin/transfer` endpoint that
  shifts `available → marginAvailable`, or (c) drop the
  `marginAvailable` column entirely and gate on `bal.available`
  (simpler; matches what `closePosition`'s self-close return
  effectively does anyway). Pick one — current behavior is "open
  always fails."

### Q-5.2: Promised keeper-registration endpoint and `liquidation-watcher.test.ts` are absent
- **Severity:** **blocker** (plan-vs-implementation drift on two explicit deliverables)
- **Location:**
  - `docs/phases/phase-5/plan.md:78-79` promises `POST /api/v2/me/keeper/register`.
  - `docs/phases/phase-5/plan.md:155-159` promises `apps/worker/src/liquidation-watcher.test.ts` ("round-trip the poll loop with a fake db + a fake price feed").
  - Glob `apps/web/app/api/v2/me/keeper/**` → zero matches.
  - Glob `apps/worker/src/liquidation-watcher.test*` → zero matches.
- **Issue:** Two of the plan's named deliverables shipped as
  nothing. The keeper-register endpoint is missing entirely; the
  `/api/v2/keeper/liquidations` GET and `[id]/claim` POST are
  open to any authenticated user with zero registration step.
  The liquidation-watcher test is missing entirely; the worker
  poll loop has zero test coverage despite the architect's
  Cond. #3 ("Liquidation worker uses DI seam") — the seam exists
  on paper (`pollLiquidations(pricer, db = prisma)`) but is
  unexercised.
- **Why this matters:** Two separate process failures in one
  phase:
  - Paranoid-qa.md §9 row 3 claims "✅ `pollLiquidations(pricer, db = prisma)`" — the function signature does take a fake db, but no test ever passes one. The DI seam is performative.
  - Paranoid-qa.md §10 claims "`pnpm test` → 45/45 pass (12 files; was 33/33 in 10 files; +8 from `margin.test.ts`, +4 from `place.test.ts`)". The arithmetic: 33 + 8 + 4 = 45. There is no liquidation-watcher.test contribution counted because no such file exists. The number is internally consistent — which means the QA tracker noticed the file was absent and silently rebased their accounting, instead of escalating it.
  - Architect-review.md condition #3 is documented as met when in fact only half is (the seam exists; the test that justifies it doesn't).
- **Suggested fix:** Ship both. The watcher test is mechanical
  given the existing `PriceClient` and `LiquidationDb` types in
  `liquidation-watcher.ts:52-59` — a fake `pricer` + an in-memory
  `db` stub with three method shapes; 30-line test file. The
  keeper-register endpoint is also one route file; even if its
  behavior is purely "set a `keepers` table row" the plan said
  it ships.

### Q-5.3: Liquidation math duplicated inline in the worker — divergence-by-copy risk
- **Severity:** major (engineering hygiene)
- **Location:** `apps/worker/src/liquidation-watcher.ts:13-50` duplicates
  `MAINTENANCE_MARGIN_BPS`, `KEEPER_REBATE_BPS`, `liquidationPriceFor`,
  `breachesMaintenance`, and `keeperRebate` from
  `apps/web/lib/engine/margin.ts:8-76`.
- **Issue:** Two copies of the maintenance-margin formula. The
  build-author's commit message says "Code-share with web is
  duplicated inline rather than cross-workspace imported
  (smallest viable seam; revisit in Phase 6 if engine grows)."
  This justification is reasonable for one phase but creates a
  ticking divergence bomb:
  - If anyone changes `MAINTENANCE_MARGIN_BPS` from 50 (or
    `KEEPER_REBATE_BPS`, or the formula shape) in `margin.ts`
    without also editing `liquidation-watcher.ts`, the worker
    will flag positions at one boundary and the keeper close will
    settle at a different boundary — producing nondeterministic
    balance state. There is no test that pins the two copies to
    each other.
  - Phase 6 explicitly extends margin-collateral semantics for
    lending (architect-review.md "Forward note for Phase 6").
    The probability the Phase-6 author touches one copy without
    the other is non-trivial.
  - This is the same drift shape the Phase-3 review flagged
    around `D` helpers being scattered, which the Phase-3 fix-up
    was forced to consolidate. The lesson did not carry.
- **Why "smallest viable seam" doesn't apply here:** the seam
  *already exists*. `apps/worker` imports `Prisma` from `@bvbe/db`
  (`liquidation-watcher.ts:10`). A `@bvbe/engine` package, or
  even adding `margin.ts` to the existing `@bvbe/shared`, costs
  one workspace entry and a path mapping. The actual cost is the
  half-hour of moving the file; "revisit in Phase 6" pushes that
  cost into a phase that's already planned to add new
  collateral semantics on top.
- **Suggested fix:** Move `apps/web/lib/engine/margin.ts` to
  `packages/shared/src/margin.ts` (re-exported from `@bvbe/shared`),
  delete the inline copy in `liquidation-watcher.ts:13-50`, and
  re-run tests. Or, at minimum, add a vitest pinning test that
  imports both implementations and asserts they agree on a
  representative cell of (side, entry, size, collateral) inputs.

### Q-5.4: `closePosition` leaves `Balance.amount` desynced from `available + locked + marginAvailable`
- **Severity:** major (latent accounting bug, not a vuln)
- **Location:** `apps/web/lib/engine/margin-orchestrator.ts:144-187`
- **Issue:** Walk the keeper-close balance math for the position
  owner:
  - L149: `marginBorrowed: { decrement: borrowed }` — fine.
  - L161: `marginAvailable: { increment: safeReturn }` — fine.
  - **Missing:** no update to `amount`. But this row's `amount`
    was incremented when collateral was originally deposited and
    when `openPosition` did *not* update it (see L70-76:
    `openPosition` decrements `marginAvailable` and increments
    `marginBorrowed`, leaving `amount` unchanged).
  - Net result over the position lifecycle: `amount` was never
    moved at any point, but `available + locked + marginAvailable`
    drifts every time a position opens or closes with non-zero
    PnL. If `amount` is supposed to represent the
    sum-of-buckets (which is the obvious mental model — and
    `place.ts:223-227`'s `upsertBalance` treats it that way:
    `available: { increment }, amount: { increment }` together),
    then the invariant `amount = available + locked +
    marginAvailable` (or whatever the team's intended invariant
    is) is silently broken.
  - The keeper credit at L163-177 does increment both `available`
    and `amount` symmetrically, which is correct for the spot
    pattern. The position-owner side is the asymmetric one.
- **Why this matters:** No production code currently reads
  `amount` for the owner-side check after a margin close, so this
  is latent. But the Phase-6 lending/staking + Phase-7 withdrawal
  features will. The accounting reconciliation that catches this
  in Phase 7 will be expensive (debugging "where did 0.5 BTC
  go?" across margin and spot history). Cheaper to fix now while
  the shape is fresh.
- **Note re: planted-vulns rule:** Not a security finding (no
  user gains balance from this; if anything, future withdrawal
  paths gating on `amount` would *under-credit*). Pure
  accounting hygiene. Fixing does not weaken any V-NNN.
- **Suggested fix:** Decide whether `amount` is "total" or "spot
  total" and document it on the `Balance` model in
  `schema.prisma`. If "total" — apply the PnL delta to `amount`
  in `closePosition` (`amount: { increment: pnl }` on the owner
  side; ensure `openPosition`'s collateral-shuffle nets to zero
  on `amount`). If "spot total" — leave the orchestrator alone
  and add an invariant test that explicitly excludes margin
  buckets from `amount`.

### Q-5.5: `openPosition` price estimate read outside the transaction (Phase-4 Q-4.10 recurrence)
- **Severity:** major (race, not a vuln)
- **Location:** `apps/web/lib/engine/margin-orchestrator.ts:44-54`
- **Issue:** The best-ask/bid lookup (L44-52) runs outside the
  `$transaction` opened at L63. Between the read and the tx
  commit, the order book can move arbitrarily:
  - A market-buy from another user lifts the ask.
  - The maker at the read price cancels.
  - Another margin open races and locks the same liquidity.
  In all three cases, `openPosition` records `entryPrice =
  estPrice` and `liquidationPrice = liquidationPriceFor(..., estPrice, ...)`
  — values that no longer reflect what the book offered at
  transaction time. The plan (L100-103) says "Settlement: position
  records `entryPrice` from the average fill price (from the
  trades that filled the open)." The implementation doesn't fill
  anything — `placeOrder` is imported but only `void placeOrder`'d
  (see Q-5.6). The "estimate" is the entry.
- **Why this matters:** Phase-4 Q-4.10 was raised on the same
  pattern in `place.ts:bestPriceEstimate` and the Phase-4 fix-up
  rejected market orders against an empty book but did not move
  the estimate inside the tx (acknowledged as a "lab is single-
  process" deferral). Phase 5 inherits that deferral. Given that
  this margin shape is the *consumer* of CHAIN C, a tx-external
  read of the public-ish book is a defensible *vulnerability
  surface* (and could be a future V-NNN). For Phase-5 engineering
  quality, the question is just whether the code reflects the
  plan. It doesn't (plan says "average fill price from trades";
  code says "best resting ask at last lookup"). The plan-vs-impl
  drift is the engineering finding; the race is a side-effect of
  it.
- **Suggested fix (functional only):** Either (a) update plan
  wording to match what's actually shipped (an oracle-style entry
  from the book, not an executed order), or (b) move the lookup
  inside the tx and accept that the architect-allowed
  simplification is still simpler than the plan claims. Do not
  add `SELECT FOR UPDATE` semantics; the lab is single-process
  and prior architects have explicitly waved that off.

### Q-5.6: Dead imports / `void` silencers in `margin-orchestrator.ts`
- **Severity:** major (smells like a missing implementation, not a smell)
- **Location:**
  - `apps/web/lib/engine/margin-orchestrator.ts:2` imports `placeOrder` from `./place`.
  - L8 imports `KEEPER_REBATE_BPS` from `./margin`.
  - L61 binds `feeTier = await feeTierForUser(args.userId)`.
  - L104 `void feeTier;`
  - L191-192 `void placeOrder; void KEEPER_REBATE_BPS;`
- **Issue:** The orchestrator imports the place-order engine and
  the fee-tier system, computes a fee tier per call, and then
  silences the unused-warnings via `void`. Read against the plan
  (L94-103: "Margin orders go through the same matching engine
  as spot. … `POST /api/v2/me/margin/positions` → opens a
  `MarginPosition` and places a market order via the existing
  `placeOrder` for the position size."), the missing call is
  **the entire margin-spot bridge**. The position records an
  `entryPrice` from a book read; the underlying market hit that
  would actually move that BTC into the position-owner's spot
  balance never happens. The comment at L100-103 acknowledges
  this ("the platform 'borrows' the rest of the position
  synthetically") — but that contradicts the plan's "settles
  from trades that filled the open" wording.
- **Why this matters:** This is the exact "we'll wire it up
  later" shape that Phase-3 Q-3.7 / Phase-3 Q-3.8 forced the
  build-author to retroactively close. Two of three imported
  symbols are dead; the third (`feeTier`) is computed and
  thrown away. A future reviewer (or Phase-6 author) will see
  the imports, assume the matching engine is invoked, and build
  Phase-6 lending on a false premise.
- **Note re: planted-vulns rule:** Wiring `placeOrder` into the
  open path would actually *strengthen* CHAIN C reach (the
  attacker's wash trades would also affect the victim's open),
  but the unwired state is just a half-built feature, not a
  planted-vuln preservation. Removing the dead imports does
  not weaken any V-NNN.
- **Suggested fix:** Either (a) wire `placeOrder` into the open
  path as the plan says (record real fills as `entryPrice`,
  apply `feeTier` to a real order, write `Trade` rows), or
  (b) delete the three dead imports and the three `void` lines,
  and rewrite the orchestrator comment at L101-103 as the
  implementation contract instead of a forward-looking apology.

### Q-5.7: `margin.ts` exports both `D` (via implicit module scope) and `D_HELPER = D`
- **Severity:** minor (rename half-finished)
- **Location:** `apps/web/lib/engine/margin.ts:6` (`const D = (v) ... => new Prisma.Decimal(v)`) and L78 (`export const D_HELPER = D;`).
- **Issue:** `D` is module-private (not exported), but at the
  bottom of the file `D_HELPER = D` is exported. Nothing in the
  codebase imports `D_HELPER` (grep returns one hit, the
  declaration itself). Best guess: a half-finished rename.
  Either `D` is meant to be exported as `D` (matches
  `margin-orchestrator.ts:14` which redefines its own `D`), or
  `D_HELPER` is meant to be removed.
- **Suggested fix:** Delete L78. Consolidate the `D` helper into
  `@bvbe/shared` alongside the proposed engine move from Q-5.3.

### Q-5.8: `place.test.ts` ships as validation-only despite plan promising balance-conservation
- **Severity:** minor (acceptable scoping; calling out for the record)
- **Location:** `apps/web/lib/engine/place.test.ts:1-52`
- **Issue:** Plan (L153-156) promised "balance-conservation across
  place/match/cancel; rejects negative amounts; market-order
  refund correctness." Shipped tests cover only the four
  validation guards (`amount = 0`, `amount = -1`, `price = 0`,
  malformed pair). The file header comment at L11-16 acknowledges
  the deferral and cites architect approval; architect-review.md
  Cond. #1 confirms approval ("`place.test.ts` with DI seam,
  covering balance conservation … **No tests pin V-25 self-trade
  behavior.**").
- **Why this matters:** The architect approved validation-only,
  but the *form* of the approval is suspicious: the original
  Phase-4 Q-4.4 deferral was "needs a DI seam so we can test the
  matching path without spinning up real prisma." Phase 5's
  resolution is "deferred to Phase 6" — and the seam still
  doesn't exist. The risk is that Phase 6 will see the test file
  exists, mark Q-4.4 closed, and never build the seam.
- **Suggested fix:** Acceptable for Phase 5 because the architect
  signed it off. For the record, the right resolution is to
  carry the Q-4.4 marker forward explicitly in
  `docs/phases/phase-6/plan.md` as "Q-4.4 still open; close in
  Phase-6 if engine grows." Otherwise it falls off the radar.

### Q-5.9: Self-close empty-book fallback at entry price — engineering smell, not exploitable
- **Severity:** minor (data quality)
- **Location:** `apps/web/app/api/v2/me/margin/positions/[id]/route.ts:36`
  (`const closedPrice = markOrder?.price ?? pos.entryPrice;`)
- **Issue:** If the book has no resting limit order on the close
  side at self-close time, the close settles at `entryPrice`.
  Realized PnL = 0; collateral returned in full. That looks
  exploitable on the surface ("free hedge: open, manipulate book
  to clear opposite side, self-close at entry to avoid a loss"),
  but the cost to clear the opposite side strictly exceeds the
  saved loss — clearing the opposite side requires the user (or
  their confederate) to take all the resting liquidity, which is
  exactly the loss they would have taken via the close. Not
  exploitable as written.
- **What it IS:** noise in the realized-PnL series. A position
  closes "at entry" with no actual market exit. Reporting,
  downstream PnL aggregation, and any future tax/audit export
  will see a fake-zero realized PnL row.
- **Why it matters anyway:** The keeper-claim path
  (`[id]/claim/route.ts:61`) has the *same* fallback. In the
  CHAIN C scenario, the attacker's wash trades may also clear
  the opposite side of the victim's position. The worker still
  flags the liquidation (based on the manipulated last-trade
  price), but the keeper-claim close settles at *entry*, not
  the manipulated price — which means the keeper's rebate fires
  but the attacker's planned "buy the victim's collateral on the
  way down" doesn't, because the close didn't happen at the
  manipulated mark. **This narrows CHAIN C's payoff** to just
  the 50bps rebate. Re-read adversarial-qa.md L73-77: "Position
  closes at $40k." That assumes the $40k order is still on the
  book at claim time. If the attacker drained it (which is *how*
  they made $40k the last trade in the first place), it won't be.
- **Note re: planted-vulns rule:** This is a CHAIN C reach
  question, not a planted-vuln weakening. The chain's existence
  is intact (V-25 + the worker reading the cached HTTP price);
  what's narrowed is the per-incident profit. Architect may want
  to surface this for Phase-6/9 amplifier discussion. The fix
  (read the trade-tape price, not the book-snapshot price) would
  weaken V-25's reach — do NOT apply.
- **Suggested handling:** Leave the code alone. Note in
  `docs/phases/phase-5/adversarial-qa.md` (or escalate to
  architect) that the documented CHAIN C profit step is
  conditional on the manipulated-side order still being on the
  book at keeper-claim time.

### Q-5.10: Adversarial QA's "end-to-end" claim is unverified against the deployed HTTP stack
- **Severity:** minor (process)
- **Location:** `docs/phases/phase-5/adversarial-qa.md` L83-85
  ("The PoC script `docs/phases/phase-5/poc-scratch.mjs`
  confirms the math…").
- **Issue:** The adversarial QA verdict ("CHAIN C completes
  end-to-end") rests on a PoC scratch script that exercises the
  margin math in-process. The actual chain crosses six
  process/HTTP boundaries:
  1. Web matching engine writes self-trade `Trade` row (V-25).
  2. Web public-price endpoint reads `Trade` row.
  3. (nginx public-price cache TTL ~5s — not verified active in this phase's compose deltas.)
  4. Worker fetches via `WEB_INTERNAL_URL` (`apps/worker/src/index.ts:14,29-35`).
  5. Worker writes `Liquidation` row.
  6. Keeper hits `POST /api/v2/keeper/liquidations/{id}/claim`, which calls `closePosition` with a fresh book-snapshot price (`apps/web/app/api/v2/keeper/liquidations/[id]/claim/route.ts:52-61`).
  Adversarial QA exercised step 1's math and step 6's math in
  isolation. The end-to-end claim "confirmed against real engine
  math" is technically true; the documented chain narrative is
  not.
- **Suggested handling:** Lab process improvement: future
  adversarial-QA chain-completion claims should require a real
  HTTP run-through (curl-against-running-stack, recorded as a
  shell script in the phase docs). Not a Phase-5 fix; a Phase-6
  + plan-doc-template improvement.

### Q-5.11: Schema relations `marginPositions` / `liquidationsClaimed` declared but never queried
- **Severity:** nit
- **Location:** `packages/db/prisma/schema.prisma:105-106` (`marginPositions MarginPosition[]`, `liquidationsClaimed Liquidation[] @relation("liquidation_keeper")`).
- **Issue:** Both relations are declared on `User`. Grep across
  `apps/` for `marginPositions` and `liquidationsClaimed` returns
  zero non-schema hits. Equivalent unused state in Phase 4
  (`tradesAsTaker`, `tradesAsMaker`) — same situation today;
  also still unqueried.
- **Why it's a nit not a major:** Declaring back-relations
  documents intent and costs nothing at runtime (Prisma
  generates the type without a query). It will save the Phase-6
  author a schema edit if they need to list a user's positions
  by relation rather than by `findMany({where:{userId}})`. Leave
  as-is.

### Q-5.12: Phase-0/1/2/3/4 pattern recurrence sweep — clean
- **Severity:** nit
- **Result:**
  - `useSearchParams` without Suspense — no new client routes
    introduced this phase that read query params (margin and
    keeper pages use `useState` + `authedFetch`). No hits.
  - Module-scoped state without `globalThis` (Phase-3 dev-loop
    pattern) — no new module-scoped mutables added this phase.
  - Open-redirect shape (Phase-1) — no auth redirects modified.
  - `make test` / `pnpm test` regression — paranoid-qa.md
    reports 45/45 pass; not independently re-run here but
    arithmetic is internally consistent.
  - Negative-amount probe against margin endpoint —
    `apps/web/app/api/v2/me/margin/positions/route.ts:33-36`
    uses `positiveDecimal = /^\d+(\.\d+)?$/ + Number > 0` (same
    shape as the Phase-4 fix-up for orders). Clean for `size`.
    `leverage` is `z.union(z.literal(2|3|5|10))`. Clean.

---

## Planted-vuln integrity check

Per the standing instruction, spot-checked that no planted vuln
was inadvertently weakened in this commit.

| V-NNN | Location | Status post-Phase-5 |
|---|---|---|
| V-25 (self-trade not blocked) | `apps/web/lib/engine/match.ts` | ✅ Intact. `matchAgainstBook` still has no `taker.userId === maker.userId` filter. CHAIN C primitive preserved. |
| V-27 (lex tier compare) | `apps/web/lib/kyc-tier.ts:54` | ✅ Intact AND reach EXPANDED as planned. New caller in `apps/web/app/api/v2/me/margin/positions/route.ts:62` passes string min (`"1"`, `"2"`, `"10"`) — adds the third caller passing a string-typed `min` to `requireTier`. With `claims.kycTier` as number, the comparison resolves via JS string-conversion of the left operand, hitting the lex-compare path. As architect-review.md L33 specified. |
| V-42 (zero-conf tier-3 credit) | `apps/worker/src/deposit-watcher.ts` | ✅ Intact (not touched this phase). |
| V-35 (middleware bypass) | `apps/web/middleware.ts` / admin routes | ✅ Intact (not touched this phase). |
| V-23 (WS gateway origin/ACL) | `apps/ws-gateway/src/server.ts` | ✅ Intact. Architect Cond. #2 confirmed as a forward-note comment only; no code change applied. |
| V-32 (cancel/match race) | `apps/web/lib/engine/place.ts` | ✅ Intact. |
| V-22 (mass-assign edit) | `apps/web/app/account/orders/edit-order.ts` | ✅ Intact. |
| V-4 (no ownership on `orders/[id]`) | `apps/web/app/api/v2/me/orders/[id]/route.ts` | ✅ Intact. |
| V-43 (fee-tier cancelled volume) | `apps/web/lib/engine/fees.ts` | ✅ Intact. |
| Surfaces-to-leave-clean | various | ✅ Unchanged from Phase 4. |

**No security-flavored items were softened, "fixed," or had
their reachability reduced in this commit.** V-27's reach
actually expanded as planned (new caller). CHAIN C's
end-to-end *narrative* has a narrower payoff than the docs
claim (see Q-5.9 — keeper close settles at entry price when
the manipulated side is drained), but that's a documentation
issue, not a code change; nothing was weakened.

---

## Verdict

**Block.** Phase 5 cannot be considered complete:

- Exit criterion #2 ("Tier-1+ user can open a long or short position via the UI") is unmet because of Q-5.1 (`marginAvailable` never funded). The architect's review never tested the open path end-to-end; paranoid-qa.md §10 reports tests pass but did not run the documented UI flow.
- Two named deliverables missing (Q-5.2): no keeper-register endpoint, no `liquidation-watcher.test.ts`.

Once those are addressed, the secondary concerns (Q-5.3 duplicated
math, Q-5.4 `amount` desync, Q-5.6 dead imports masquerading as
the margin-spot bridge) collectively constitute three majors
that would not block on their own but should be cleaned up in a
fix-up commit before Phase 6 grafts onto this surface — Phase 6
extends the margin-collateral semantics for lending, and lending
on top of half-finished collateral plumbing will compound.

The good news, narrowly: the math in `margin.ts` is correct, the
matching-engine self-trade primitive (V-25) is still intact, the
worker→web HTTP read is correctly architected per architect
Cond. #2, and the keeper-claim transaction is genuinely atomic
on the `keeperUserId` slot.

---

## Trend across phases

| Phase | Blockers | Majors | Minors+Nits | Verdict |
|---|---|---|---|---|
| 0 | 3 | 7 | — | Block |
| 1 | 3 | 4 | — | Block |
| 2 | 0 | 2 | — | Pass w/ conditions |
| 3 | 0 | 3 | — | Pass w/ conditions |
| 4 | 1 | 3 | — | Block (Q-4.1 unintended vuln) |
| **5** | **2** | **5** | **6** | **Block (functional)** |

The trend reversed in Phase 4 (one blocker, on an unintended
vuln) and worsens in Phase 5 (two blockers, both functional).
The Phase-5 blockers are categorically different from
Phase-0/1/2/3 ones — those were "the scaffolding doesn't compile"
shape; Phase 5's are "the planned feature was implemented as a
skeleton and signed off without running it." The gate process
caught the Phase-4 unintended vuln after Adversarial QA missed
it; the same gate sequence missed Q-5.1 and Q-5.2 here.
Recommend: future phase Paranoid QA must include "actually open
the new feature in a browser, sign in as a tier-1 user, complete
the documented happy path" before signing off — not just `pnpm
test` + checklist.

— L7 QA

---

## Addendum — Build-author response (2026-06-01)

Both blockers, three of five majors, and three of the minors
closed. No security-flavored remediation applied — V-25, V-27,
V-42, V-35, V-23, V-32, V-22, V-4, V-43 all confirmed intact via
re-run of poc-scratch + spot-check of locations.

### Blockers — both FIXED

- **Q-5.1 (marginAvailable never funded):** New migration
  `20260601010000_phase_5_fixup` backfills `marginAvailable =
  amount` for existing rows. New endpoint
  `POST /api/v2/me/margin/transfer` moves balance between
  `available` and `marginAvailable` for future deposits.
  Exit criterion #2 ("Tier-1+ user can open a position via the
  UI") now achievable.
- **Q-5.2 (missing deliverables):**
  - `POST /api/v2/me/keeper/register` shipped at
    `apps/web/app/api/v2/me/keeper/register/route.ts`. Sets
    `User.keeperRegisteredAt`. Tier-1+ gate. The
    `liquidations/[id]/claim` handler now rejects (403) if the
    caller hasn't registered.
  - `apps/worker/src/liquidation-watcher.test.ts` shipped. Four
    tests: flag at breach, skip when not breached, no double-
    flag, skip pairs with null last. The `pollLiquidations(pricer,
    db = prisma)` DI seam is now exercised.

### Majors — three FIXED, two deferred per architect rule

- **Q-5.3 (duplicated margin math):** Moved
  `apps/web/lib/engine/margin.ts` into
  `packages/shared/src/margin.ts`. Worker `liquidation-watcher.ts`
  imports `breachesMaintenance` + `keeperRebate` from
  `@bvbe/shared`. Web `engine/margin.ts` is now a thin re-export
  shim. `@bvbe/shared` gained `@bvbe/db` as a workspace dep so it
  can use the `Prisma.Decimal` type from there. Single source.
- **Q-5.4 (`Balance.amount` semantics undocumented):** Added a
  block comment to the `Balance` model in `schema.prisma`
  documenting the field contract:
    - `amount`          = spot subtotal (available + locked)
    - `marginAvailable` = margin sub-account free
    - `marginBorrowed`  = platform borrow, informational
    - Phase 6 lending/staking adds new columns, doesn't overload
  The `closePosition` "no `amount` update on owner side" behavior
  is now correct-by-design (margin moves don't touch `amount`).
- **Q-5.5 (price estimate race) and Q-5.6 (dead imports):** Phase-5
  shipped the synthetic-borrow design (no real placeOrder fires
  on margin open). Q-5.6 closes by removing `placeOrder` /
  `feeTierForUser` / `KEEPER_REBATE_BPS` imports and the `void`
  silencers from `margin-orchestrator.ts`, and updating the
  module-header comment to declare the design intent ("Phase 6
  architect decides whether to wire placeOrder into open path").
  Q-5.5's "race vs plan-vs-impl" framing is resolved by the comment
  update: the implementation is now self-describing.

### Minors / nits — fixed or noted

- **Q-5.7 (`D_HELPER` half-rename):** deleted along with the
  margin.ts→shared move (the helper is no longer needed in the
  shim).
- **Q-5.8 (`place.test.ts` validation-only):** Acknowledged;
  architect approval re-confirmed. Will surface in the Phase-6
  plan as "Q-4.4 still open."
- **Q-5.9 (narrowed CHAIN C per-incident payoff):** Documented
  in the `adversarial-qa.md` second addendum.
- **Q-5.10 (end-to-end claim boundary):** Documented in the
  same addendum.
- **Q-5.11 (unused User relations):** No change.
- **Q-5.12 (pattern recurrence sweep):** Verified clean.

### Re-verification (executed)

- `pnpm test` → **49/49 pass** (13 files; was 45/45 in 12 files;
  +4 from `liquidation-watcher.test.ts`)
- `pnpm --filter @bvbe/{shared,web,worker,bitcoin-mock} exec tsc --noEmit` → all clean
- `pnpm --filter @bvbe/web build` → succeeded end-to-end
- `pnpm tsx docs/phases/phase-5/poc-scratch.mjs` → CHAIN C math
  still fires; nothing weakened

### No security hardening applied

Spot-checked: V-25 (no self-match filter in `match.ts`), V-27
(string lex compare with new caller in
`apps/web/app/api/v2/me/margin/positions/route.ts`), V-42, V-35,
V-23, V-32, V-22, V-4, V-43 all intact. The `transfer` and
`keeper/register` endpoints are clean by design (they're
infrastructure for the feature to work, not vulnerability
surfaces).

Phase 5 is genuinely complete. Forward note for Phase 6: the
`Balance` field contract now lives in `schema.prisma`; new
sub-account columns (lending pool supply/borrow, staking) should
be added the same way rather than overloading existing fields.
Q-4.4 carries forward as "still open if `place.ts` grows."

— build-author
