# Phase 6 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-06-15
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 6 attempts four product surfaces in one slice. That is large.
But the four are conceptually distinct and don't share a critical
arithmetic path (lending interest, staking flat APY, OTC matching,
P2P escrow are four separate state machines), so the vertical-slice
discipline holds: each surface is small individually, the schema
adds are additive, and the planted vulns are three — one per
yield-bearing/desk feature, none in P2P. P2P is the **clean
surface** for this phase (raises Phase-7/8 plant surface area).

Build-author's track record after Phase-5 fix-up: ships clean
arithmetic when forced, plants vulns realistically when allowed.
Phase 6 keeps that pattern: lending math is the messiest path, so
that's where V-44 lives; staking is simpler so V-45's race is the
only flaw; OTC's privileged path is a header-trust pattern that
real desks really do get wrong.

## Vuln placement review

Three plants approved. The Phase 6 entries get numbers V-44, V-45,
V-46 — increment from the existing 21 (V-1, V-4, V-8…V-43; the
ledger is non-contiguous because the master plan reserved numbers).

### V-44 — Lending interest off-by-one credit (HARD)

**Approved with re-shape.** Build-author's plan correctly identifies
that "rounding dust accruing to reserve" is not exploitable, and that
the actual flaw is the denominator off-by-one when a new supplier
enters a pool with existing borrow load. Pin this exact framing in
VULNS.md; do not also list a separate rounding-dust entry. One
flaw, one V-NNN.

The mechanism: on tick `t`, the accrual computes
`interest_t = utilization(t-1) * apy * deltaSeconds * borrowed(t-1)`,
distributes it across `supply_positions_at_t` (not `_at_t_minus_1`).
A user who supplies between tick `t-1` and tick `t` gets a share of
interest that was earned by borrowers when their supply did not yet
exist. Worth real money if the attacker times deposits before a tick
on a high-utilization pool. Discoverable by reading the accrual loop
side-by-side with the tick boundary, or by an econ-attack mindset.

**Realistic root cause:** engineer copy-pasted "compute interest, then
loop over positions" without thinking about the position-set timing.
Compound v1 had a variant of this; Cream had a worse variant.

### V-45 — Staking reward claim race (MEDIUM)

**Approved.** Build-author's framing — `findMany → update[]` outside
a transaction on the claim endpoint — is exactly the master-plan
catalog entry (V-31 reapplied to staking instead of referral promo).
Two simultaneous claim requests with HTTP/2 single-packet timing
both see the same unclaimed rows and credit the user twice.

**Realistic root cause:** engineer treated the claim endpoint as
read-modify-write and forgot that the read isn't fenced from the
write. Common in early staking implementations.

The architect adds one **must-do**: the claim handler MUST mark each
`StakingClaim` row with a `claimedAt` field (NULL until claimed,
timestamp after), and the planted flaw is that the `WHERE claimedAt
IS NULL` filter is in the `findMany` but the `update` is unconditional.
The race window is real. **Do not** add `claimedAt IS NULL` as a
predicate on the update — that would close the flaw at the SQL layer.

### V-46 — OTC desk privilege via spoofable header (MEDIUM)

**Approved with structural condition.** The plan's framing is good:
`x-bvbe-desk-role: maker` triggers a zero-fee privileged path on
the accept handler, and the nginx config is supposed to strip
`x-bvbe-*` from client requests but doesn't list `x-bvbe-desk-role`
in the strip list. The structural condition: **the header strip MUST
exist for some `x-bvbe-*` headers** (e.g., `x-bvbe-user-id`,
`x-bvbe-internal-trace`) so that the omission of `x-bvbe-desk-role`
looks like a forgotten add rather than a design absence. The nginx
config gains an explicit `proxy_set_header x-bvbe-user-id "";` line.
Adding `proxy_set_header x-bvbe-desk-role "";` would close the
flaw, so don't add that.

**Realistic root cause:** internal desk plumbing had `x-bvbe-desk-role`
as a way for the internal OTC console to identify itself; nginx
strip list was set up for `x-bvbe-user-id` and `x-bvbe-internal-*`
but the desk role header was added later and the strip list was
never updated. Plausible team-org failure.

## Architect resolutions for the open questions

1. **Interest cadence: 60s.** Approved. Lab-realistic.
2. **OTC internal book.** Approved option (b) — opaque "desk inventory"
   pool. Keeps CHAIN C contained to spot/margin and doesn't expose
   OTC fills to oracle manipulation by trainees who aren't focused
   on CHAIN C.
3. **P2P escrow lock: lock-on-create.** Approved. Matches Binance UX.
4. **Staking unstake: instant.** Approved. No PoS unbonding.
5. **Borrow LTV: 150%, liquidation at 110% in `yield-accrual.ts`.**
   Approved. **Do not** route lending liquidations through the
   margin liquidation worker; they are conceptually separate
   sub-accounts and merging them would muddy CHAIN C's narrative
   (CHAIN C is margin-only).
6. **V-44 single-flaw framing: off-by-one credit only.** Approved.
   See V-44 section above.

## Conditions for Gate 2 entry

1. ✅ Phase 5 fix-up F-1 (transfer asset registry pin) closes here:
   add `apps/web/lib/assets.ts` exporting a `KNOWN_ASSETS` set
   seeded with BTC/USDT/USDC/ETH/LTC/DOGE plus whatever altcoins
   Phase 6 surfaces (mock ETH for staking, etc.); both the lending
   and staking endpoints — and the Phase 5 `margin/transfer`
   endpoint, updated in passing — validate `asset` against this set.
   The set is the schema-layer registry; do not use the
   `TradingPair` rows because lending assets need not have a trading
   pair (e.g., a staking-only asset).
2. ✅ Yield accrual worker uses the same DI seam pattern as
   deposit-watcher and liquidation-watcher. Worker tests use the
   same fake-DB shape.
3. ✅ `Prisma.Decimal` throughout interest math. NO `Number`
   intermediates. Per-second rate uses
   `apyBps.div(SECONDS_PER_YEAR.mul(10_000))` style.
4. ✅ P2P trade endpoints validate `offerId` ownership properly
   on cancel/release. P2P is the clean surface — do not introduce
   an IDOR here even though it would be trivial. Phase 8's stored
   XSS in display name is the admin-side counterpart already and
   leaks into the P2P trade detail when the admin reviews disputes
   (Phase 8 plants that connection).
5. ✅ OTC privileged path's fee bypass MUST be in the accept handler,
   not in the matcher. The matcher (`matchOtc`) should accept a
   `feeBps` parameter from its caller; the caller decides whether
   to pass 0. This way the matcher itself is clean code and the
   trust boundary is the accept handler — realistic for how a real
   team would have written it.
6. ✅ Lending pools seed: at least 3 pools (BTC, USDT, ETH). Staking
   programs seed: at least 2 (mock ETH, mock LTC).
7. ✅ `Balance.amount` invariant (Phase 5 Q-5.4) preserved. Lending
   supply locks `available` and unlocks on withdraw — same shape as
   spot order locks. Interest credits to `available` (and `amount`)
   directly. Staking principal moves out of `available` into a new
   `StakingPosition.principal` field — `amount` decreases by the
   staked principal (because staked balance is NOT spot subtotal).
   Document this in the schema comment.
8. ✅ Migration is named `20260615000000_phase_6_yield_otc_p2p`
   matching the Phase-5 fix-up convention (date-prefixed).
9. ✅ Tier gates: lending supply/withdraw/borrow/repay = Tier-1+;
   staking stake/unstake/claim = Tier-1+; OTC quote/accept = Tier-2+;
   P2P offers/trades = Tier-1+.

## Surfaces to leave clean — unchanged from Phase 5

- `/api/v1/internal/*` (Phase 8)
- nginx CL/TE-tolerant directives (active, exploited Phase 9)
- `lodash` / deep-merge gadgets (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8 — PDF export plant)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)
- KYC URL-import allowlist (Phase 2 + CHAIN D, already planted)

Phase 6 is allowed to import lodash methods like `_.sumBy` for
math convenience IF AND ONLY IF the import is from a lodash module
that does not include `_.merge` / `_.mergeWith` / `_.set`. The
build-author should use destructured imports (`import sumBy from
"lodash/sumBy"`) so the dependency surface stays minimal. If this
proves awkward, use plain `Array.reduce` and skip lodash entirely.

## Forward note for Phase 7

Phase 7 lands withdrawal + treasury (BullMQ withdrawal worker,
PSBT cold→hot signing). The Phase-6 lending borrow side prefigures
the withdrawal worker's same async-credit pattern. **Phase 7
architect should consider**: the V-44 off-by-one credit pattern
echoes a flaw class that fits cleanly in the withdrawal-credit
flow too; if Phase 7 needs a "rounding gadget" for CHAIN A, it can
borrow the shape but **not** the V-NNN — plants are per-phase.

## Forward note on chain reach

- **CHAIN A** (drain hot wallet): unchanged. Phase 7 is the next
  primary surface; Phase 6 doesn't contribute primitives.
- **CHAIN B** (become admin + persist): unchanged. Phase 8 + 9.
- **CHAIN C** (mass liquidation via oracle manipulation): complete
  end of Phase 5. Phase 6 does NOT extend the oracle surface.
- **CHAIN D** (DB+KYC exfil): the lending pool data view at
  `/api/v2/public/lending/pools` is a *candidate* information-leak
  surface for an "internal reserves" admin-side variant — flag
  for Phase 8 architect as something to consider but NOT plant
  here.

## Test discipline

- Unit tests for the yield-math module hit conservation properties:
  for any seeded pool state, after N ticks, the sum of position
  accruals plus reserve delta equals the integral of the rate
  function. **One test deliberately exposes V-44's off-by-one** but
  is marked `it.skip(...)` with a comment "open question for Phase
  6 review" — Adversarial QA's PoC will demonstrate the same.
  Actually no — **do not ship a `.skip`'d V-44 test**. Adversarial
  QA owns the PoC. Tests should not signpost the plant.
- The staking claim test covers happy-path single-claim only.
  Adversarial QA owns the race-condition PoC.
- The OTC accept test covers normal-path fee charging. Adversarial
  QA owns the header bypass.

## Gate 2 entry: GO

Build-author may proceed to Staff Eng implementation.

— Architect
