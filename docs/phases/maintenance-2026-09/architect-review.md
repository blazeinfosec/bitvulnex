# Maintenance 2026-09 — Architect review

**Date:** 2026-09-25
**Scope type:** functional bug-fix pass. No new features, no new plants.
**Reviewed after implementation:** the owner asked for a functional-only
sweep, so the reviewers' findings served as the plan. This note records
the scope decisions made before and during the fixes.

## Scope confirmed

Fix functional defects that stop an honest user, trainee, or instructor
from using the lab:

- Lab bring-up: Makefile, reset and cohort scripts, compose wiring,
  `.env.example`, line endings on Windows checkouts, and the README.
- Ledger integrity: balance `amount` drift on fills and margin transfers,
  refunds on failed withdrawals, non-BTC withdrawals routed to the BTC
  mock, and mock-node coin loss on failed sends and RBF.
- Worker health: market-maker book hygiene, ticker cost, price drift,
  deposit-watcher false drops, and job-error logging.
- Broken user flows: token refresh, navbar state, P2P completion,
  staking claims after unstake, keeper registration, WS message shapes,
  and error states.
- CTF: validators and flag emission that rejected legitimate proofs.

## Vuln allocation

**None.** This pass plants nothing and removes nothing. Every `V-NNN` in
`VULNS.md` and all four chains must stay exploitable. The only
`VULNS.md` edit corrects a factual error in the V-40 bypass list.

## Surfaces to leave alone

- Anything on a `V-NNN` path that would change its exploitability:
  middleware trust branches, JWT v1, tier comparison, matching, fee tier,
  withdrawal submit, limits, RBF refund, treasury broadcast, staking claim
  race, `PATCH /me` schema, and the WS gateway's auth and channel model.
- Price mean-reversion in the market maker. It could damp the
  self-trade → oracle → liquidation path (CHAIN C).

## Escalated, not fixed (need an Architect ruling)

1. `apps/worker/src/withdrawal-processor.ts`: the broadcast success path
   updates by `id` without a `status: "pending"` guard and can overwrite
   a concurrent user cancel. Not in `VULNS.md`. Candidate unintended
   vuln; decide whether to fix or ledger it.
2. Password reset does not revoke outstanding refresh tokens. Not in
   `VULNS.md`; same decision needed.

## Deferred features (not bugs)

Stop-limit/OCO triggering (V-32's write-up assumes it works), support and
compliance role access, API-key authentication, cohort membership API,
email verification, and referral links.

## Exit criteria

- Workspace typecheck and unit tests pass.
- Adversarial QA confirms every `V-NNN` and all four chains are still
  exploitable after the fixes.
- Paranoid QA signs off on lab safety and ledger accuracy.
