# Phase 3 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-05-30
> **Verdict:** Approved with conditions.

## Scope assessment

Real exchanges land deposits right after KYC. Schema (BitcoinAddress
+ Deposit + Balance) is right-sized. Mock bitcoind finally getting
real regtest semantics is overdue and unblocks Phase 7 (PSBT signing)
and Phase 9 (CHAIN A finale). Vertical slice covers DB + worker +
API + UI + tests.

## Vuln placement review

- **V-24 (address validation bypass):** Correct to land the validator
  in `@bvbe/shared/btc-address.ts` even though Phase 3 doesn't consume
  the vulnerable branch. The "ship the function, consume in Phase 7"
  pattern mirrors V-27 from Phase 2. Three bypasses (testnet HRP,
  zero-width strip, OP_RETURN-shaped) give trainees a small puzzle
  with multiple solutions. ✅
- **V-42 (zero-conf tier-3):** `minConfirmationsForTier` returning
  0 for tier 3 is the realistic root cause — engineer thinks "they
  passed enhanced KYC, the risk is acceptable" and the team never
  writes the reconciliation job. Pairs with RBF for a teaching-grade
  Mt-Gox-flavor scenario. ✅

Neither vuln is too obvious. No tell comments. Approved.

## Architect resolutions for the open questions

1. **Balance in Phase 3, minimal shape.** Approved. Phase 4 extends
   with locked/available; the column add is additive.
2. **Dev affordances gated by env var only.** Approved. `LAB_AFFORDANCES_ENABLED`
   controls *visibility* of the buttons in the UI and *availability*
   of the dev endpoints. Role-gating would be a forward "this only
   works for some users" hack that the lab doesn't need.
3. **`minConfirmationsForTier` in the worker.** Approved. The worker
   is the only consumer in Phase 3. If Phase 4+ needs to read the
   same threshold for its own logic (e.g., a deposit-history page
   that says "X more confirmations until credit"), refactor then.
4. **No address-display polish.** Approved. The lab benefits from
   the raw display — trainees who paste the V-24 zero-width-attack
   string into their browser DevTools `console.log()` can spot the
   `​` chars. That's the discovery moment.

## Conditions for Gate 2 entry

1. ✅ V-24 ships with happy-path tests (mainnet bc1, regtest bcrt1,
   legacy P2PKH/P2SH) but **no** tests for the three vulnerable
   bypasses
2. ✅ V-42 ships with a documented PoC in `adversarial-qa.md` that
   walks the full zero-conf-credit-then-RBF scenario against the
   mock bitcoind
3. ✅ Lab affordances clearly labelled DEV/LAB ONLY in both UI and
   API responses (`X-Lab-Affordance: true` header on responses, or
   a `note: "lab affordance"` field in the JSON body)
4. ✅ The mock-bitcoind upgrade preserves the Phase-0 RPC contract
   (same method names, same shape) — `@bvbe/bitcoin-rpc-types`
   stays the source of truth
5. ✅ Worker process binds to the new queue with a graceful
   shutdown path so `down -v` doesn't leak running jobs
6. ✅ Deposit page in the UI shows the address as a copyable string,
   no QR-rendering library (keep dependency surface flat)

## Surfaces to leave clean (carried forward — all still hard rules)

- `/api/v1/internal/*` (Phase 8)
- nginx `proxy_cache_*` (Phase 4)
- nginx CL/TE-tolerant directives active (Phase 9)
- WebSocket server (Phase 4)
- `lodash` / deep-merge (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)

Paranoid QA re-greps at Gate 4.

## Forward note for Phase 4

Phase 4 (spot trading) will consume `Balance` heavily and introduce
the `locked` / `available` split. The Phase-4 architect should:
- Extend the Balance migration additively (no breaking changes)
- Wire `requireTier` (V-27 site) into trading endpoints with a
  **string** tier label so V-27 fires
- Plant V-23 (CSWSH on order-book WebSocket) — this is the first
  WebSocket in the project, so the architect's "surfaces to leave
  clean" list updates to drop "WebSocket server"

## Verdict

**APPROVED.** Phase 3 scope is right, vuln placements are realistic,
CHAIN A inches closer (mock bitcoind is now actually usable for
Phase 7's PSBT flow). Staff Eng may proceed after the 6 conditions
above are reflected in the implementation.

— Senior Architect
