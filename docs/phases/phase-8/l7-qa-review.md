# Phase 8 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-28
**Scope:** commit `cdf0270` — "phase 8: admin panel + compliance + support tickets -- CHAIN A closes"
**Verdict:** PASS WITH NITS

## Methodology

- Read `CLAUDE.md`, `VULNS.md` (33 entries), `docs/phases/phase-8/{plan,architect-review,adversarial-qa,paranoid-qa}.md`, including the V-34 re-plant addendum.
- `git show cdf0270 --stat` (63 files, +5078/-24) and selective `git show cdf0270 -- <path>` paging.
- Read each new planted-vuln carrier file: `apps/web/middleware.ts`, `apps/web/app/api/v1/internal/{healthz,users,users/[id],trade-debug/replay,treasury/emergency-withdraw}/route.ts`, `apps/web/app/api/v2/admin/{users/search,users/[id]/{freeze,unfreeze,balance-adjust},compliance/report,compliance/cases/[id]/export-pdf,tickets/[id],tickets/[id]/reply}/route.ts`, `apps/web/app/api/v2/me/{flags,tickets/[id],tickets/[id]/reply}/route.ts`, `apps/web/app/admin/users/{page,[id]/page}.tsx`, `apps/web/app/admin/tickets/[id]/page.tsx`, `apps/web/app/support/tickets/[id]/page.tsx`, `apps/web/lib/{auth-role,feature-flags}.ts`, `apps/web/lib/withdrawal/{submit,freeze}.ts`, `apps/web/lib/otc/accept.ts`, `packages/shared/src/markdown.ts`, `nginx/nginx.conf`, `packages/db/prisma/migrations/20260625000000_phase_8_admin_compliance_support/migration.sql`.
- Re-ran the full verification gauntlet: `pnpm install`, `pnpm test` (102/102), `tsc --noEmit` across all 5 packages, `pnpm --filter @bvbe/web build`.
- Spot-checked Phase 0-7 vuln carriers via `git diff HEAD~1 HEAD -- <carrier>` (zero-diff = untouched).
- Empirically tested the V-34 gadget end-to-end under the real route's zod schema (not just the inline test reimplementation) — see Majors §1.

## Findings

### Blockers

None.

### Majors

1. **V-34 end-to-end reach via the documented payload shape is blocked by zod.**
   The route at `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:15-18` validates the body with `z.object({ scenario: z.string(), config: z.record(z.unknown()).optional() })`. Zod (currently `3.x` in the lockfile) strips own enumerable `__proto__` keys at the top of a `z.record(...)` parse. Result: the documented `VULNS.md` payload `{"config":{"__proto__":{"adminPanel":true}}}` (V-34, line 455 of `VULNS.md`) is silently rejected — `parsed.data.config` contains zero own keys, `deepMerge` runs against an empty source, and `Object.prototype` is not mutated. Verified locally:
   ```
   const parsed = schema.safeParse(JSON.parse('{"scenario":"x","config":{"__proto__":{"replayTestFlag":true}}}'));
   // parsed.data.config own keys: []
   // Object.prototype.replayTestFlag → undefined
   ```
   **The plant is NOT a no-op** — a *nested* pollution payload still lands:
   ```
   {"scenario":"x","config":{"a":{"__proto__":{"adminPanel":true}}}}
   ```
   Zod's top-level `__proto__` stripping doesn't recurse into `z.unknown()` values, so the deepMerge recurses into `a`, iterates `Object.keys({__proto__:{...}})` which yields `__proto__`, and writes to `target["a"]["__proto__"]` (which resolves to `Object.prototype`). PoC: trial run confirms `Object.prototype.adminPanel === true` after this request.
   The `feature-flags.test.ts::"scenario: trade-debug config flows into flag defaults"` test uses an **inline copy** of the deepMerge that bypasses zod entirely (line 41-51), so the test's green status does not actually demonstrate end-to-end reach through the route. Adversarial QA's re-plant addendum (lines 757-762 of `adversarial-qa.md`) overstates this — the test pins the gadget shape, not the route reach.
   **Recommendation (non-blocking):** update VULNS.md V-34 exploitation path to use the nested-pollution payload form; OR extend the feature-flags test to run the actual route handler (including the zod parse) end-to-end. The plant lands; the documented PoC does not.

2. **OpenAPI registry drift.** Plan §"Admin API" specifies 24 new endpoints, but `apps/web/app/api/openapi.json/route.ts` only registers three new ones (lines 66-68: `/api/v2/me/flags`, `/api/v2/me/tickets`, `/api/v2/admin/users/search`). All other Phase 8 surfaces — compliance cases / report / export-pdf, ticket detail/reply/status, user freeze/unfreeze/balance-adjust, the entire `/api/v1/internal/*` namespace — are absent. The architect's "all 24 new routes registered" implicit gate is unmet. This is a docs-vs-implementation drift, not a vuln, but it makes the OpenAPI doc materially incomplete for downstream tooling (and for the trainee browsing `/docs` looking for `?perf=1` as a discovery surface for V-11).

### Minors / Nits

1. **Admin landing missing Treasury sub-link.** Plan §"UI surfaces" enumerates "Tickets, Compliance, Users, Treasury" sub-nav. `apps/web/app/admin/page.tsx:32-65` ships Users/Tickets/Compliance/KYC. Treasury (the operator path to draft-create / sign / list — which the architect's `requireAdmin` notes call out as separate from the `/api/v1/internal/treasury/emergency-withdraw` plant) has no entry. Functional gap, not a security one.
2. **Support nav-link gating drift.** Plan §"UI surfaces" says "add Support link for logged-in users." `apps/web/components/ui/navbar.tsx:33-35` adds the link unconditionally — visible to anonymous visitors. The link goes to `/support` which 401s for anons; the UX is slightly worse than the plan called for. Trivial.
3. **`balance-adjust` does not validate target user exists.** `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts:48-75` runs `tx.balance.upsert` then `tx.adminAuditLog.create`. If `targetUserId` doesn't exist, the `Balance.userId → User.id` FK fails, returning HTTP 500 instead of a clean 404. Not a vuln (operation rolls back atomically inside the `$transaction`); minor sloppiness. The Phase-8 adversarial QA already flagged this and elected to accept it — concur.
4. **`balance-adjust` accepts unbounded signed delta.** Schema is `z.string().min(1)`; any `Prisma.Decimal`-parseable value is accepted. Both `amount` and `available` change together so the `Balance` invariant holds. Negative deltas can push `available` below zero. This is admin-only and architect-blessed as "no direct planted vuln here." Concur — keeping clean.
5. **V-34 route comments mention "trade-debug" twice.** `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:1-7,26-28` repeats the "trade-debug replay" framing in both file and function docstrings. Reads naturally (it IS a debug replay endpoint), no signposting concern, but worth tracking that the operator narrative is the only justification for the deepMerge existing at all in production code.
6. **`feature-flags.ts` defaults variable name churn.** `defaults = Object.create({})` is then immediately seeded via `Object.assign(defaults, overrides)` before the `for...in` loop. The name `defaults` is slightly misleading — at iteration time the object contains overrides as own keys and prototype-inherited pollution as walked-into keys. Reads OK as "framework default flag inheritance" framing but feels slightly off. Cosmetic.

### Regressions of planted vulnerabilities

**None.** Spot-checked via `git diff HEAD~1 HEAD -- <path>` — all returned empty diffs:
- V-25 (`apps/web/lib/engine/match.ts`) — untouched.
- V-27 (`apps/web/lib/kyc-tier.ts`) — untouched; new admin gates use `requireAdmin`, not `requireTier`.
- V-28 (`apps/web/lib/withdrawal/submit.ts`) — the new `isUserFrozen` check at `submit.ts:77-79` lands **before** the V-28 `findUnique → checkAndDebitLimit → update → create` race (`submit.ts:83-119`). Race surface intact, freeze check does not race with it.
- V-33 (`apps/web/lib/treasury/coordinator.ts` + `apps/bitcoin-mock/src/rpc/index.ts`) — untouched; `decodePsbt` first-segment vs `finalizepsbt` last-segment divergence preserved.
- V-35 (`apps/web/middleware.ts:34-36`) — `x-middleware-subrequest` short-circuit preserved; the new V-6 branch at lines 44-50 sits below it without interference.
- V-42 (`apps/worker/src/deposit-watcher.ts`) — untouched.
- V-44, V-45 (Phase 6 plants) — untouched.
- V-46 (`apps/web/app/api/v2/me/otc/accept/route.ts:43-44`) — header read still in the route handler, upstream of the new `$transaction` wrap inside `acceptOtc`. Header-based fee bypass still lands.

### Unintended-vuln spot-check (all clean unless noted)

- IDOR on freeze / unfreeze / balance-adjust / user detail — all gate `requireAdmin`; `freeze` and `unfreeze` validate target exists via `findUnique` and 404.
- Ticket IDOR (`/api/v2/me/tickets/[id]` + `/reply`) — `ticket.userId !== claims.sub → 403` at `route.ts:22` and `reply/route.ts:25`.
- Ticket reply mass-assignment — user-side reply schema is `z.object({ body: z.string().min(1).max(10_000) })`; `isAgent` is hard-coded to `false` in the route handler. Closed.
- Compliance routes — all gate `requireAdmin`; create validates `subjectUserId` resolves.
- `/me/flags` — only reads caller's own claims; no `userId` parameter.
- PDF export path traversal — `?name=../../etc/passwd` reaches `/tmp/${name}.pdf` but is strictly subsumed by V-17 (the same input is the cmd-injection vector).
- Emergency-withdraw still requires `draft.status === "signed"` (`coordinator.ts:130-131`).
- Admin ticket reply — gated by `requireAdmin`; non-admins cannot post with `isAgent: true`.
- `/api/v1/internal/users` returns full PII including `passwordHash` and `totpSecret` — architect-blessed CHAIN D pivot.
- Closed admin zod schemas — all use closed `z.object({...})`; no `.passthrough()` / `.catchall()`.
- `resolveFlags({})` (no claims, no pollution) returns `{}` correctly; the `for...in` empty walk is benign.

## V-34 re-plant verification

- `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:29-45` — hand-rolled `deepMerge` present, walks `Object.keys(source)`, recurses unconditionally on object children. ✅
- No `lodash` import anywhere in `apps/web` (`grep lodash` on `apps/web/**/{*.ts,*.tsx,package.json}` returns zero matches). ✅
- `apps/web/lib/feature-flags.ts:12-21` — `defaults = Object.create({})` (prototype reaches `Object.prototype`); `Object.assign(defaults, overrides)`; `for (const k in defaults)` walks the prototype chain, captures polluted keys as own properties on the returned `flags`. ✅
- `apps/web/lib/feature-flags.test.ts` — 4 tests, all passing (per the test run below). The "scenario: trade-debug config flows into flag defaults" test demonstrates the **gadget** (inline `deepMerge` writing into `Object.prototype`, then `resolveFlags` capturing into own properties, then implicit serialization). It does **not** drive the actual route handler.
- End-to-end through the real route: works with the **nested payload** `{"scenario":"x","config":{"a":{"__proto__":{"adminPanel":true}}}}` (verified locally with the route's actual zod schema). Top-level `__proto__` payload as documented in VULNS.md does NOT land due to zod's own-key stripping — see Majors §1.

V-34 plant is exploitable end-to-end via insider reach (V-6 header + nested pollution payload). The trainee may find the documented top-level payload doesn't work and discover the nested form themselves — arguably a more realistic discovery experience. Updating VULNS.md's exploitation path is the cheapest fix.

## OTC double-fill closure verification

- `apps/web/lib/otc/accept.ts:23-56` — entire matcher wrapped in `db.$transaction`; the claim is an `updateMany` predicated on `status: "quoted"` AND `quoteExpiresAt > now`; `claim.count === 0` throws. Idempotent under concurrent accept. ✅
- `apps/web/lib/otc/accept.test.ts:136-148` (per the adversarial-QA citation; actual file is 160 lines) — pins the concurrent-accept invariant: two concurrent calls yield exactly one fulfilled / one rejected. ✅
- V-46 header read in the route handler (`apps/web/app/api/v2/me/otc/accept/route.ts:43-44`) is upstream of `acceptOtc` and is NOT closed by the `$transaction` — correct (V-46 is a distinct plant, the double-fill is a separate functional bug).

OTC double-fill carryover U-7.1: **CLOSED.**

## CHAIN A end-to-end reach

Walked the chain under the insider-threat model with the `.env.example` JWT secret as the (Phase 9) git-history-leak stand-in:

1. **JWT signing key** — `.env.example` line `JWT_SECRET=replace-me-with-a-32-byte-random-secret`. ✅
2. **JWT verify path** — `apps/web/middleware.ts:13-29` (`claimsFromHeader`) calls `jwtVerify(..., secretBytes(), {issuer:"bvbe", audience:"bvbe-web", algorithms:["HS256"]})`. HS256 + `JWT_SECRET` ⇒ forged admin JWT verifies. ✅
3. **V-6 reach to internal namespace** — middleware lines 44-50: `if (path.startsWith("/api/v1/internal")) { if (header) return next() }`. nginx (`nginx/nginx.conf:57-69`) strips only `x-bvbe-user-id`; `x-bvbe-internal-trace` passes through untouched. External attacker can hit any `/api/v1/internal/*` route with `x-bvbe-internal-trace: 1` and **no Authorization header at all**. ✅
4. **Treasury draft acquisition** — either (a) reuse an existing operator-signed draft via `GET /api/v2/admin/treasury/drafts?status=signed` with the forged admin JWT, or (b) create + double-sign via two different forged `sub` JWTs (`coordinator.ts:88,108-114` flips `status: signed` once count ≥ 2). ✅
5. **`broadcastDraft` accepts `overridePsbt`** — `emergency-withdraw/route.ts:25-29` passes `parsed.data.overridePsbt` straight into `broadcastDraft({..., overridePsbt})`. `coordinator.ts` `broadcastDraft` reads `args.overridePsbt ?? draft.psbtBase64`. ✅
6. **V-33 polyglot bypass** — `packages/shared/src/psbt-envelope.ts` `decodePsbt` reads the first `BVBE_PSBT_V1:` segment (which matches the draft's intended outputs to victim); `apps/bitcoin-mock/src/rpc/index.ts:124` builds `canonical = PSBT_MARKER + segs[segs.length - 1]` (the last segment, which encodes the attacker output). `validateIntendedOutputs` passes, `finalizepsbt` finalizes the attacker output, `sendrawtransaction` broadcasts to the attacker address. ✅

CHAIN A walks end-to-end as of `cdf0270`. Phase 9's only remaining contribution is moving `JWT_SECRET` from `.env.example` (discoverable trivially) to a removed-but-historical `.env.bak` (discoverable via `git log --all -p`) — i.e., upgrading the chain from insider to zero-knowledge.

## Architect's Gate-2 conditions (from `architect-review.md` §"Conditions for Gate 2 entry")

1. `/api/v1/internal/*` middleware path separate from v2 main flow — ✅ (`middleware.ts:44-50` dedicated branch; v2 branches at lines 52+ untouched).
2. `x-bvbe-internal-trace` strip missing from nginx; prior `x-bvbe-user-id` strip preserved — ✅ (`nginx/nginx.conf:68` strips only user-id).
3. All admin routes go through `requireRole(claims, "admin")` via `apps/web/lib/auth-role.ts` — ✅ (file exists; every `/api/v2/admin/*` route reviewed gates via `requireAdmin`).
4. OTC fix uses `$transaction` + `updateMany` predicated on `status: "quoted"` AND `quoteExpiresAt > now`, idempotent — ✅.
5. `scripts/pdftk-mock.sh` exists; Dockerfile makes it executable — ✅ (script exists; `apps/web/Dockerfile` diff in commit chmods + copies to `/usr/local/bin/pdftk-mock`).
6. `packages/shared/src/markdown.ts` exports `sanitizeForAdmin` (V-18 vulnerable) and `sanitizeForUser` (strict) — ✅.
7. `apps/web/lib/feature-flags.ts` uses `Object.create({})` pattern; `/api/v2/me/flags` reads it — ✅.
8. Trade-debug-replay endpoint at `/api/v1/internal/trade-debug/replay` — ✅ (path exists). NOTE: arch condition 8 originally specified the `lodash` import; the re-plant correctly replaced this with hand-rolled `deepMerge` and the condition is effectively superseded by the addendum.
9. Phase 8 plants 7 new V-NNNs; total in VULNS.md = 33 — ✅ (grep of `^### V-` across `VULNS.md` returns 33).
10. Migration name `20260625000000_phase_8_admin_compliance_support` — ✅.

## Surfaces to leave clean

- **nginx CL/TE-tolerant directives** — grep on `proxy_request_buffering|chunked_transfer_encoding|Transfer-Encoding` over `nginx/nginx.conf`: zero hits. ✅
- **`.env.bak` / git-history secret leak** — `ls .env*` returns only `.env.example`. ✅
- **V-15 vulnerable transitive dep** — `apps/web/package.json` adds no known-CVE pin; the brief `lodash` dep from the failed first V-34 attempt was removed during the re-plant. ✅
- **Dependency confusion artifact** — no `publishConfig.registry` flip, no suspicious `bvbe-*` package names in any Phase-8 `package.json`. ✅
- **`eval` / `node-serialize` / unsafe deserializers** — grep over `apps/web/app/api/v1/internal/**`, `apps/web/app/api/v2/admin/**`, `apps/web/app/admin/**`: zero hits. ✅
- **V-23 WS gateway origin** — `apps/ws-gateway/src/server.ts` untouched in commit `cdf0270`. ✅
- **V-40 KYC SSRF** — `apps/web/app/api/v2/me/kyc/import-url/route.ts` untouched. ✅

No Phase-9-reserved surface touched.

## Verification re-run

```
pnpm install                                 → up to date, clean
pnpm test                                    → Test Files 27 passed (27), Tests 102 passed (102), 3.27s
pnpm --filter @bvbe/shared exec tsc --noEmit → clean
pnpm --filter @bvbe/web    exec tsc --noEmit → clean
pnpm --filter @bvbe/worker exec tsc --noEmit → clean
pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit → clean
pnpm --filter @bvbe/db     exec tsc --noEmit → clean
pnpm --filter @bvbe/web build                → built, route table includes all new Phase-8 routes
```

No warnings of substance. The build output enumerates `/support`, `/support/new`, `/support/tickets/[id]`, all `/api/v2/admin/*` and `/api/v1/internal/*` routes as expected.

## Forward note for Phase 9

Phase 9 has one substantive technical task (CL/TE-tolerant nginx directives for CHAIN B step) and three artifact tasks (the `.env.bak` git-history leak, the V-15 pin, the dependency confusion artifact). The CL/TE block, when activated against this nginx config, will need to coexist with the existing `proxy_cache` block on `/api/v2/public/*` — the cache-key composition is what CHAIN C's poisoning step depends on, so be careful not to refactor that block while adding smuggling tolerance. The architect's note at `nginx.conf:32-34` already foreshadows this. Also: the V-34 documented-payload issue (Majors §1) is worth fixing as a small editorial pass to VULNS.md in Phase 9 even though it's not a blocker for Phase 8 commit — the chain enrichment story reads better with a working PoC string.

## Verdict and recommendation

**PASS WITH NITS.** Commit `cdf0270` lands cleanly. All seven Phase-8 plants are realistically placed (no signposting), no unintended vulnerabilities of consequence, all Phase 0-7 V-NNN carriers untouched, CHAIN A walks end-to-end with the `.env.example` JWT secret stand-in, the OTC double-fill carryover closes correctly, the V-34 re-plant lands at the *gadget* level (test confirms the deepMerge + `for...in resolveFlags` chain works in isolation), and lab-safety is preserved.

The two notable issues are documentation drift, not code drift:
- VULNS.md V-34 exploitation path documents a top-level `__proto__` payload that zod rejects at the schema layer; the working payload is the nested variant.
- 24 new endpoints; only 3 registered in the OpenAPI registry.

Both are editorial fixes. Neither blocks commit. Recommend merging Phase 8 and addressing the two nits in a Phase 9 housekeeping pass alongside the planned V-15 / `.env.bak` / CL/TE work.

— L7 QA
