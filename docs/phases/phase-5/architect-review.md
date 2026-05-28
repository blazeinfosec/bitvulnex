# Phase 5 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-06-01
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 5 sits in the awkward space of "real money math, no new
plants." The margin engine has to be correct enough that the
CHAIN C scenario reads as a *realistic catastrophe* — if the
engine has obvious bugs, trainees will exploit those instead of
the planted oracle attack. The Phase-4 L7 audit established that
the build-author can ship clean arithmetic when the Phase-4
fix-up forced the discipline; carry that forward.

## Vuln placement review

No new V-NNN. CHAIN C completion is the deliverable. Confirmed:

- The liquidation worker MUST read the public price feed via HTTP,
  not directly from the DB. The HTTP path is what V-25
  manipulates; DB-direct would mean reading the same data via a
  query that bypasses the wash-trade Trade rows. **The architect
  insists on the HTTP read.**
- Keeper rebates come from the closed position's collateral. The
  "insurance fund" alternative would route money through a
  platform pool and require admin involvement to extract — closes
  the chain's profit step.
- Leverage caps wired via `requireTier(claims, "10")` (string) at
  the highest tier. **V-27 reaches another caller** but its
  exploit direction is still subtle and waits for Phase 7
  withdrawal limits. Architect approves keeping V-27 latent.

## Architect resolutions for the open questions

1. **Margin orders reuse `placeOrder`.** Approved. One matching
   engine; one place-tx orchestrator; one set of tests.
2. **Liquidation worker reads `/api/v2/public/price/*` via HTTP.**
   Approved. CHAIN C requirement.
3. **Keeper rebate from position collateral.** Approved.
4. **Per-tier leverage via `requireTier` with string label.**
   Approved.

## Conditions for Gate 2 entry

1. ✅ Phase-4 deferred Q-4.4 closes in this commit: `place.test.ts`
   with DI seam, covering balance conservation across place/match/
   cancel sequences, rejecting negative amounts, market-order
   refund correctness. **No tests pin V-25 self-trade behavior.**
2. ✅ Q-4.11 (WS rotation) addressed as a documented comment on
   `ws-gateway/src/server.ts`; no code change.
3. ✅ Liquidation worker uses the same DI seam pattern as the
   deposit watcher.
4. ✅ Keeper claim endpoint is a single transaction (avoid
   double-claim races); idempotent on already-claimed.
5. ✅ Margin engine math is `Prisma.Decimal` throughout (carry
   forward Phase-4 Q-3.11 discipline).
6. ✅ ADL queue (auto-deleveraging) is **out of scope for Phase 5**
   per simplicity. Plain keeper-claimed liquidations only.
   Document as Phase-9 polish if needed.
7. ✅ Margin endpoint validates `pair` against the seeded
   `TradingPair` rows (Phase-4 Q-4.6 hygiene).

## Surfaces-to-leave-clean — unchanged

- `/api/v1/internal/*` (Phase 8)
- nginx CL/TE-tolerant directives active (Phase 9)
- `lodash` / deep-merge (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)

## Forward note for Phase 6

Phase 6 lands lending/staking/yield + OTC/P2P. The Phase-5
collateral-and-borrowed split prefigures the lending pool's
borrow/supply shape. Phase 6 should reuse `marginBorrowed` as the
borrow side of lending positions (or introduce a parallel
`lendingBorrowed` — Phase-6 architect picks).

## Verdict

**APPROVED.** The architectural call this phase is small but
load-bearing: the worker MUST go through HTTP for the oracle,
or CHAIN C breaks. Otherwise standard margin shape. Staff Eng
may proceed once the 7 conditions are reflected.

— Senior Architect
