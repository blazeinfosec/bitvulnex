# Phase 4 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-05-31
> **Verdict:** Approved with conditions.

## Scope assessment

Six new vulns is the largest plant in one phase so far. All are
realistic at the placements proposed. Spot trading is the natural
follow-on from deposits (Phase 3) and the foundation for margin
(Phase 5). The vertical slice covers DB + matching engine + WS +
API + UI + tests + nginx + Phase-3 housekeeping. Right-sized.

## Vuln placement review

- **V-4 (order IDOR):** Sequential int IDs + missing
  `userId === claims.sub` check on GET/DELETE is the canonical
  IDOR shape. The realistic root cause ("we extracted the
  generic `findUnique` pattern and forgot to add the ownership
  filter") is the Phase-2 KYC pattern repeated. ✅
- **V-22 (Server Action mass assign):** Spreading `FormData` into
  Prisma `update` is exactly how rushed Server-Action code
  reaches production. ✅
- **V-23 (CSWSH):** A WS gateway that doesn't verify `Origin` is
  the textbook CSWSH shape. Pairs nicely with token-in-query-
  string for trainee discovery. ✅
- **V-25 (self-trade):** Engine that doesn't filter
  `makerUserId === takerUserId` is the realistic root cause for a
  small-team exchange. CHAIN C consumes this for oracle
  manipulation in Phase 9. ✅
- **V-32 (OCO race):** Cancelling one leg of an OCO pair while
  the other is mid-match is a classic TOCTOU window. ✅
- **V-43 (fee tier counts cancelled maker side):** A subtle
  business-logic bug. Trainees discover by inspecting the volume
  query in `fees.ts`. ✅

None too obvious. None with tell comments.

## Architect resolutions for the open questions

1. **Matching engine in-process on web.** Approved. A dedicated
   `apps/engine` would be more realistic but adds another
   container at a moment when Phase 4 already adds `ws-gateway`.
   Defer the engine split to Phase 5 if margin needs it.
2. **V-27 stays latent through Phase 4.** Approved. Phase 7
   withdrawal limit check is where V-27 fires.
3. **WS token in query string.** Approved. The browser doesn't
   send Authorization on WS upgrade requests; query string is the
   conventional workaround and adds a token-in-URL leak as a
   discovery bonus. CSWSH + token-leak are siblings in the V-23
   write-up.
4. **OCO via `ocoPairId` self-FK.** Approved. Simpler schema.

## Conditions for Gate 2 entry

1. ✅ The Phase-3 L7 deferrals (Q-3.7 upsertJobScheduler, Q-3.8
   IORedis instance reuse, Q-3.11 Prisma.Decimal discipline)
   ship in the same commit as Phase 4.
2. ✅ Engine `match.ts` is a pure function (no DB import);
   `place.ts` orchestrates DB + engine.
3. ✅ Engine ships tests for happy-path matching (price-time
   priority, partial fills, market orders) but NOT for self-
   trade behavior.
4. ✅ Fee-tier helper ships tests for happy paths but NOT for
   the cancelled-order-counts bug.
5. ✅ V-22's Server Action is reachable via direct POST (not
   only via the form on the page). Realistic root cause requires
   the action endpoint to accept arbitrary form fields.
6. ✅ `ws-gateway` is a separate service in docker-compose with
   no host port mapping; nginx proxies `/ws/*` to it.
7. ✅ nginx `proxy_cache` directives ship for `/api/v2/public/*`
   but the actual cache-poisoning attack waits for Phase 9.

## Surfaces-to-leave-clean — updated list

Phase 4 retires "WebSocket server" from the list (it's now
present). Remaining reservations:

- `/api/v1/internal/*` (Phase 8)
- nginx CL/TE-tolerant directives **active** (Phase 9 — the
  proxy_cache directives that land in Phase 4 are NOT the
  CL/TE-tolerant ones)
- `lodash` / deep-merge (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)

Paranoid QA re-greps at Gate 4.

## Forward note for Phase 5

Margin extends `Balance` with margin-specific columns. The Phase-4
`locked`/`available` split is the foundation; Phase 5 adds
`marginAvailable`, `marginBorrowed`, `liquidationPrice`. The
matching engine learns to read margin positions. **CHAIN C's
liquidation-cascade attack** lands in Phase 5: oracle-manipulated
mid (V-25 already in place) cascades into Phase-5 liquidations.

## Verdict

**APPROVED.** Staff Eng may proceed once the 7 conditions are
reflected. Six planted vulns + the three Phase-3 housekeeping
items = a big commit. Expect Adversarial QA to need extra time
to walk every PoC.

— Senior Architect
