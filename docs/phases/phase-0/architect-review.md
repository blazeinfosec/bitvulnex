# Phase 0 — Architect Review (Gate 1)

> **Reviewer role:** Senior Architect. Reviewing `docs/phases/phase-0/plan.md`
> against the project charter in `CLAUDE.md` and the master plan
> (`fancy-squishing-origami.md`).
> **Date:** 2026-05-27
> **Verdict:** **Approved with conditions** (see § Conditions). Staff Eng
> may proceed to Gate 2 only after the conditions in § Conditions are
> reflected in the plan (or a follow-up architect note).

## What I'm reviewing for

Per `CLAUDE.md` Gate 1, my job here is:

1. Does the phase scope map to real exchange functionality?
2. Which planted vulnerabilities belong in this phase vs later?
3. Are the data model, API surface, and module boundaries sound?
4. Are vulnerabilities too obvious, too contrived, or stacked
   unrealistically?
5. Produce a sign-off note with scope, vuln allocation, surfaces to
   leave clean, and exit criteria.

Phase 0 is a scaffolding phase with no planted vulns, so (2) and (4)
collapse to "verify nothing leaks in." (1), (3), (5) are the real work.

## Scope assessment

**Maps to real exchange functionality:** ✅ Yes. Every real exchange has
an nginx-or-equivalent edge, a Node/JS backend, Postgres for ledger,
Redis for cache+queues, and some form of node interface. The pnpm
monorepo split into `apps/*` and `packages/*` is what you'd see at any
mid-size fintech. No invented surfaces here.

**Vertical-slice rule:** Phase 0 deliberately ships *no* feature slice
because it's a foundation phase. The master plan (`CLAUDE.md` § Hard
rules) says "phases ship vertically — no phase ships backend-only or
frontend-only." Phase 0 ships a tiny slice (landing + `/about/changelog`
+ `/docs` + `/api/health`) that hits every layer (nginx → Next.js → DB
→ Redis). That satisfies the rule.

**Vuln allocation:** Zero planted vulns. Confirmed correct. The plan
correctly avoids:

- The CL/TE-tolerant nginx block exists but is **inert** (no upstream
  yet that would let it be exploited)
- The `/api/v1/*` namespace is **absent** in Phase 0 (deliberate — v1
  is the "legacy" home for `alg=none` etc.; introducing it now would
  invite Phase 1 vulns to leak forward)
- `.env.example` ships placeholders only; the deliberate weak-key
  fallback that becomes V-9 in Phase 1 is **not** wired yet

## Module-boundary review

The proposed structure is good but I'm pushing back on three things.

### Issue 1 — Mock bitcoind placement (answer to open question 1)

**Plan asks:** in-process or container?

**Architect decision:** **Containerized as its own service**
(`bitcoin-mock`). Two reasons:

- Phase 7's PSBT signing flaw (V-33) is the Bitfinex-flavor vuln. It's
  only realistic if the signing coordinator and the wallet RPC live
  across a network boundary — the flaw is "coordinator trusts the
  RPC's decode result without re-validating outputs." In-process kills
  that boundary and the vuln becomes contrived.
- A real exchange runs its node as a separate process or daemon. Lab
  realism > implementation convenience.

Add a 6th service to docker-compose:

| Service        | Image                | Notes                                |
|----------------|----------------------|--------------------------------------|
| `bitcoin-mock` | node:22-alpine build | Express server exposing the RPC stub |

`packages/bitcoin-mock/` becomes `apps/bitcoin-mock/`. The HTTP RPC
contract goes into `packages/shared/bitcoin-rpc-types.ts` so both the
mock and the consumer (Phase 3+) import the same types.

### Issue 2 — Swagger feature-flag (answer to open question 3)

**Plan asks:** gate `/docs` from day one, or always public?

**Architect decision:** **Always public, but read from a single
`apps/web/lib/openapi-registry.ts`** that endpoints register into. This
makes the "intentionally incomplete docs" choice from the master plan
mechanical: when Phase 8 lands the `/api/v1/internal/*` admin endpoints,
the staff engineer simply doesn't call `registerEndpoint()` for them.
The gap is by construction, not by manual omission, which is realistic
(this is exactly how careless real teams produce incomplete OpenAPI
specs).

Phase 0 implements the registry and registers `GET /api/health` and
`GET /api/openapi.json` into it. The Swagger UI page reads from
`/api/openapi.json`.

### Issue 3 — JWT scaffolding split (clarifying, not blocking)

The plan says Phase 0 ships the *clean* JWT implementation in
`packages/shared/jwt.ts` and Phase 1 adds the *vulnerable* v1 verifier
"in parallel." Be explicit: the file Phase 1 adds should be
`packages/shared/jwt-v1.ts` (a separate module), and the v1 API route
imports from `jwt-v1` while v2 imports from `jwt`. This makes the vuln
locatable to a file an auditor would actually find by reading imports
— and not contaminate Phase 0's clean file. Note this for Phase 1 Gate
1 review when we get there.

## Other open questions

### Open question 2 — Apache 2.0 vs MIT

**Architect decision:** **Apache 2.0.** Stronger patent grant matters
for a security-research tool that may be forked by orgs that worry
about IP. The friction difference vs MIT is negligible for our audience.

### Open question 4 — Makefile or pnpm only

**Architect decision:** **Both.** Ship a thin `Makefile` whose targets
are one-liners that call pnpm scripts. (`make up` → `docker-compose up
-d`, `make seed` → `pnpm seed`, `make reset` → `scripts/reset-lab.sh`.)
Cost is ~30 lines; benefit is muscle memory for the pentester audience.

## Surfaces to leave clean (do not touch in Phase 0)

These are reserved for later phases. If the staff engineer finds
themselves about to introduce one of these, they should stop and flag
it to the architect:

- `/api/v1/*` namespace — reserved for Phase 1 (legacy / vulnerable
  verifier home)
- `/api/v1/internal/*` namespace — reserved for Phase 8 (admin
  function-level access vulns)
- `.env.example` deliberate-fallback values — reserved for Phase 1
- nginx CL/TE-tolerant block activation — reserved for Phase 9
- nginx `proxy_cache` directives for `/api/public/*` — reserved for
  Phase 4
- WebSocket gateway / origin check — reserved for Phase 4
- Any deep-merge / lodash usage — reserved for Phase 8 (V-34 site)
- Any `child_process` / shell exec — reserved for Phase 8 (V-17 site)
- Any `eval` / `node-serialize` / unsafe deserializer — reserved for
  later (insecure deserialization)
- Any raw SQL or template literals into queries — reserved for Phase 8

The Paranoid QA at Gate 4 will grep for these patterns. They must
return zero hits in Phase 0.

## Vuln allocation for Phase 0

**Zero.** Explicit and verified.

## Conditions for Gate 2 entry

The Staff Engineer may begin implementation when:

1. ✅ Plan reflects the **6-service docker-compose** with `bitcoin-mock`
   broken out (Issue 1)
2. ✅ Plan reflects the **OpenAPI registry pattern** (Issue 2)
3. ✅ Apache 2.0 selected as license (open Q 2)
4. ✅ Makefile + pnpm scripts both ship (open Q 4)
5. ✅ JWT clean-vs-vulnerable split documented as a Phase-1 architect
   note (Issue 3 — this is a forward-looking note, doesn't block Phase 0)
6. ✅ The "surfaces to leave clean" list above is treated as a hard
   constraint by Staff Eng and verified by Paranoid QA

I'll treat conditions 1-4 as accepted once the plan is updated (or
once Staff Eng implements them consistent with this review). Condition
5 is a note for next phase. Condition 6 is the Paranoid QA's job at
Gate 4.

## Updated exit criteria

The plan's 10 exit criteria stand. Adding:

11. `bitcoin-mock` service is up; `curl http://exchange.local/api/health`
    is unaffected (mock has its own internal-network-only port not
    routed by nginx in Phase 0)
12. `/api/openapi.json` is built from the registry, not hand-written
13. `Makefile` exists; `make up`, `make seed`, `make reset` work
14. The "surfaces to leave clean" list returns zero `grep` hits in the
    repo at Paranoid QA time

## Verdict

**APPROVED with the six conditions above.** Phase 0 scope is sound,
boundaries are correct, no vulns leak in. Staff Eng may proceed to
Gate 2 once the plan is updated to reflect Issues 1, 2, and the
license/Makefile decisions (Issue 3 is a forward note).

— Senior Architect
