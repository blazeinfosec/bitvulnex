# Phase 11 Slice 1 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `c14d6f6` "phase 11.1: CTF emission core + 8 reference wirings"
**Verdict:** PASS WITH NITS

Slice 1 ships the CTF emission core (`apps/web/lib/ctf/{emit,claim,derive}.ts`),
the `POST /api/v2/ctf/claim` endpoint, and wires 8 reference V-NNNs end-to-end:
Pattern A inline emission for V-4, V-22, V-25, V-46 on four existing handlers;
Pattern B side-channel validation for V-1, V-13 via the claim endpoint;
Pattern C self-derivable validation for V-9, V-48 via the same endpoint. The
wiring is additive — every planted construct on every touched file is intact at
HEAD, and with `CTF_MODE=false` the response surface is byte-identical to the
pre-slice baseline on the endpoints that aren't supposed to emit. All 40 V-NNN
plants confirmed intact. Tests 164 → 191/191 (+27 new), tsc clean, claim
endpoint correctly returns 404 (not 403) when CTF mode is disabled, and the
endpoint is registered in the OpenAPI registry. Architect conditions #2
(V-22 detector on the verification step, not the PATCH) and #5 (byte-diff QA)
are both satisfied.

One genuine **MAJOR** finding: the four touched handler files now carry
`V-NNN` source comments — re-introducing the signposting pattern the L7
slice-10.6 review and the slice-7 N-0 fix scrubbed from `apps/web/app/**`,
`apps/web/components/**`, `apps/web/lib/**`. The architect should decide
whether to accept these comments (they serve as legitimate documentation for
CTF wiring) or scrub them per the post-10.6 hygiene contract.

## Methodology

- Read `CLAUDE.md`, `VULNS.md` (40 entries), `docs/phases/phase-11/plan.md`,
  `docs/phases/phase-11/architect-review.md` (original 5 conditions + slice-3/4
  addendum), and the full commit body for `c14d6f6`.
- Established change set: `git diff a173e10..c14d6f6 --name-only` returns 10
  files — 4 new files under `apps/web/lib/ctf/`, 1 new test file, 3 unit-test
  files, plus 4 existing route handlers wired in-place
  (`api/v2/me/orders/[id]/route.ts`, `api/v2/me/orders/route.ts`,
  `api/v2/me/otc/accept/route.ts`, and the new `api/v2/ctf/claim/route.ts`).
- Read every changed file in full. Cross-referenced each against `VULNS.md`.
- Confirmed empty-diff against `a173e10` for all 36+ plant-file paths cited
  in `VULNS.md` that slice 1 did NOT touch (one `git diff` over the union of
  paths, zero output).
- Read the 2 touched plant-bearing handlers in full to verify the planted
  construct is unchanged.
- Live-verified the running stack at `docker compose ps` (9/9 up): toggled
  `CTF_MODE` via `.env` + `docker compose up -d web` (NOT `restart`),
  exercised emission on/off behavior, and byte-diffed representative
  endpoints between the two modes.
- Ran `pnpm -w run test` (191/191 pass) and `pnpm --filter @bvbe/web exec
  tsc --noEmit` (exit 0).
- Restored `CTF_MODE=false` at end of session and re-validated the stack is
  healthy.

## Plant integrity (all 40 V-NNN)

The slice touches 4 plant-bearing files in code: V-4 + V-22 on
`apps/web/app/api/v2/me/orders/[id]/route.ts` (V-4 is the actual plant; V-22's
plant lives on `apps/web/app/account/orders/edit-order.ts` which is empty-diff
— the detector reads ANOTHER file's effect); V-25 detector on
`apps/web/app/api/v2/me/orders/route.ts` (the plant lives on
`apps/web/lib/engine/match.ts` which is empty-diff); V-46 detector on
`apps/web/app/api/v2/me/otc/accept/route.ts` (the plant — the `deskRole ===
"maker"` header trust line 44-45 — is intact). Every other plant file is
empty-diff. Verdict per V-NNN:

| V-NNN | Plant file (touched?) | Status |
|-------|---|---|
| V-1   | `apps/web/app/admin/users/page.tsx`, `[id]/page.tsx` (no) | INTACT (empty-diff) |
| V-4   | `apps/web/app/api/v2/me/orders/[id]/route.ts` (**touched**) | INTACT — `findUnique({where:{id:orderId}})` no userId filter on GET (L26) or DELETE (L65); detector is read-only |
| V-6   | `apps/web/middleware.ts`, `nginx/nginx.conf` (no) | INTACT |
| V-8   | `packages/shared/src/jwt-v1.ts` (no) | INTACT |
| V-9   | `apps/web/lib/env.ts`, `packages/shared/src/jwt-v1.ts` (no) | INTACT |
| V-10  | `apps/web/app/api/v2/auth/password-reset/request/route.ts` (no) | INTACT |
| V-11  | `apps/web/app/api/v2/admin/users/search/route.ts` (no) | INTACT |
| V-12  | `apps/web/app/api/v2/admin/compliance/report/route.ts` (no) | INTACT |
| V-13  | `apps/web/app/login/login-form.tsx` (no) | INTACT |
| V-14  | `apps/web/app/api/v2/me/kyc/doc/route.ts` (no) | INTACT |
| V-15  | `apps/web/package.json`, `apps/web/lib/compliance/sanctions-import.ts` (no) | INTACT |
| V-17  | `apps/web/app/api/v2/admin/compliance/cases/[id]/export-pdf/route.ts` (no) | INTACT |
| V-18  | `packages/shared/src/markdown.ts` (no) | INTACT |
| V-19  | `packages/shared/src/jwt-v1.ts` (no) | INTACT |
| V-20  | `packages/shared/src/jwt-v1.ts` (no) | INTACT |
| V-21  | `apps/web/app/api/v2/auth/refresh/route.ts`, schema (no) | INTACT |
| V-22  | `apps/web/app/account/orders/edit-order.ts` (no) — detector lives on `me/orders/[id]/route.ts` (touched) | INTACT — plant file empty-diff; detector is read-only on GET |
| V-23  | `apps/ws-gateway/src/server.ts` (no) | INTACT |
| V-24  | `packages/shared/src/btc-address.ts` (no) | INTACT |
| V-25  | `apps/web/lib/engine/match.ts` (no) — detector on `me/orders/route.ts` (touched) | INTACT — match.ts empty-diff; detector queries Trade table post-place |
| V-26  | `apps/web/lib/withdrawal/limit.ts` (no) | INTACT |
| V-27  | `apps/web/lib/kyc-tier.ts` (no) | INTACT |
| V-28  | `apps/web/lib/withdrawal/submit.ts` (no) | INTACT |
| V-30  | `apps/web/lib/withdrawal/internal-transfer.ts` (no) | INTACT |
| V-32  | `apps/web/app/api/v2/me/orders/[id]/route.ts` (**touched**) | INTACT — the DELETE handler's tx structure (lines 71-95) and lack of `SELECT FOR UPDATE`/SERIALIZABLE is preserved verbatim. The added `_flag` emission at line 99-105 reads `order.userId !== claims.sub` (V-4 only); V-32's race is unchanged. |
| V-33  | `apps/web/lib/treasury/coordinator.ts`, `apps/bitcoin-mock/src/rpc/index.ts` (no) | INTACT |
| V-34  | `apps/web/app/api/v1/internal/trade-debug/replay/route.ts`, `apps/web/lib/feature-flags.ts` (no) | INTACT |
| V-35  | `apps/web/middleware.ts` (no) | INTACT |
| V-40  | `apps/web/app/api/v2/me/kyc/import-url/route.ts` (no) | INTACT |
| V-41  | `apps/web/app/api/v2/me/kyc/documents/route.ts`, admin doc route, admin/kyc page (no) | INTACT |
| V-42  | `apps/worker/src/deposit-watcher.ts` (no) | INTACT |
| V-43  | `apps/web/lib/engine/fees.ts` (no) | INTACT |
| V-44  | `apps/worker/src/yield-accrual.ts` (no) | INTACT |
| V-45  | `apps/web/lib/staking/claim.ts` (no) | INTACT |
| V-46  | `apps/web/app/api/v2/me/otc/accept/route.ts` (**touched**) | INTACT — line 44-45 `const deskRole = req.headers.get("x-bvbe-desk-role"); const feeBps = deskRole === "maker" ? MAKER_FEE_BPS : TAKER_FEE_BPS;` byte-identical to pre-slice |
| V-47  | `apps/web/lib/withdrawal/rbf.ts` (no) | INTACT |
| V-48  | `docker-compose.yml`, git history `.env.bak` (no) | INTACT |
| V-49  | `apps/web/package.json`, no `.npmrc` (no) | INTACT |
| V-50  | `nginx/nginx.conf`, `docker-compose.yml` (no) | INTACT |
| V-51  | `apps/web/app/api/v2/me/route.ts` (no) | INTACT |

**Net: 40/40 plants intact. No regression. No softening. No removal.**

## The 8 wired V-NNN — live verification

With `CTF_MODE=true` (set via `.env`, applied via `docker compose up -d web`,
~14s for healthy):

**Pattern A (inline `_flag` on existing handler response):**

- **V-4** — `curl /api/v2/me/orders/1 -H "Authorization: Bearer <alan-T1-token>"`
  where order #1 is owned by a different user. Response: full order JSON
  plus `"_flag":"{BLAZE_BITVULNEX_a6b6182b26b6a954}"`. The plant
  (lookup without userId filter) is verbatim preserved; the detector is
  the additive read-only `order.userId !== claims.sub` check.
- **V-22** — detector wires on `GET /api/v2/me/orders/[id]` when
  `order.feeTier in {"vip","prime"}`. Per the architect's Condition #2,
  this is on the verification step, NOT on the PATCH/editOrder Server
  Action — confirmed by reading the file. Not exercised on a vip/prime
  order because no seeded order has that fee tier (the trainee has to
  exploit V-22 to set it, then `GET` to receive the flag — exactly the
  intended discovery loop).
- **V-25** — emits on `POST /api/v2/me/orders` when `prisma.trade.count` for
  the just-placed `takerOrderId` returns a row with
  `makerUserId === takerUserId`. Not live-exercised (would require placing
  a fresh self-matching order); code path inspected and validated against
  the existing `apps/web/lib/engine/match.ts` plant which is empty-diff.
- **V-46** — wires on `POST /api/v2/me/otc/accept` when
  `req.headers.get("x-bvbe-desk-role") === "maker"`. The header-trust line
  itself is unchanged. The detector is read-only and additive.

**Pattern B (claim endpoint validates exploit proof):**

- **V-1** — `POST /api/v2/ctf/claim {"vulnId":"V-1","proof":"any-tag"}` →
  200 `{"flag":"{BLAZE_BITVULNEX_a86ef83cf2214fd7}"}`. As the
  commit notes, this is the slice-1 MVP — real exfil-tag tracking lands
  slice 2. Acceptable per architect approval.
- **V-13** — `POST {"vulnId":"V-13","proof":"https://attacker.example/p"}` →
  200 with flag. Negative tests: `http://localhost/x` → 400; non-URL → 400;
  `javascript:alert(1)` → 400; `http://127.0.0.1/x` → 400.

**Pattern C (claim endpoint validates discovered secret):**

- **V-9** — `POST {"vulnId":"V-9","proof":"changeme"}` → 200
  `{"flag":"{BLAZE_BITVULNEX_4f9796051758783f}"}`. Wrong secret → 400
  `"proof does not match"`.
- **V-48** — `POST {"vulnId":"V-48","proof":"devsecret-do-not-use-in-prod-bvbe-2026"}`
  → 200 with flag. The Pattern-C derivable formula
  `sha256(vulnId + ":" + secret).slice(0, 16)` correctly does NOT use
  `CTF_SALT` (matches `apps/web/lib/ctf/derive.ts:30-33`).

**Unknown vuln:** `{"vulnId":"V-999","proof":"x"}` → 400
`"unknown vuln id or wrong pattern"`.

## Architect conditions (#2 and #5)

**Condition #2 — V-22 detector on the verification step, not the PATCH:**
✅ **MET.** Confirmed in source: `apps/web/app/account/orders/edit-order.ts`
(the Server Action that hosts the mass-assign plant) is empty-diff. The V-22
detector is on `apps/web/app/api/v2/me/orders/[id]/route.ts:45,49` (the GET
handler, triggered when `order.feeTier === "prime" || order.feeTier === "vip"`).
Architect's anti-oracle requirement satisfied — a trainee probing field names
via PATCH cannot use response-presence as an oracle.

**Condition #5 — byte-diff QA on representative endpoints with on/off:**
✅ **MET, with one note.**

Verified live:
- `GET /api/v2/me/orders/643784` (alan's own order, no exploit fires) →
  `diff /tmp/own_on.json /tmp/own_off.json` returns no differences.
- `GET /api/v2/me` (no V-NNN wired to this endpoint in slice 1) → identical.
- `GET /api/v2/me/orders/1` (the IDOR — exploit fires for alan) — diff is
  exactly `,"_flag":"{BLAZE_BITVULNEX_a6b6182b26b6a954}"` appended before
  the closing brace; the rest of the JSON is byte-identical.
- `POST /api/v2/ctf/claim` → 404 (not 403) when CTF_MODE off; 200/400 when on.

Note: `/api/v2/public/markets` reflects legitimately-changing market
timestamps and last-trade prices between the on/off captures — this is
expected per the slice-1 task description ("modulo legitimately-changing
market timestamps/prices") and is NOT a byte-diff violation.

## Byte-diff QA

Per architect Condition #5, three representative endpoints diff to zero when
no exploit fires under either mode. The structural change between modes is
strictly: an additional `,"_flag":"..."` key appended when the slice-1
detector's exploit predicate is true on a path that calls `maybeEmitFlag`.

Per the source-comment scrub check (slice-10.6 contract):

```
$ grep -rEn 'V-[0-9]+' apps/web/app apps/web/components apps/web/lib apps/web/styles
apps/web/lib/ctf/__tests__/claim.test.ts: (multiple)
apps/web/lib/ctf/__tests__/derive.test.ts: (multiple)
apps/web/lib/ctf/__tests__/emit.test.ts: (multiple)
apps/web/lib/ctf/claim.ts: (multiple — PATTERN_B_VALIDATORS keys)
apps/web/lib/ctf/derive.ts: (multiple — PATTERN_C_SECRETS keys)
apps/web/app/api/v2/me/orders/route.ts: 1 (V-25 detector comment)
apps/web/app/api/v2/me/orders/[id]/route.ts: 3 (V-4 GET, V-22, V-4 DELETE)
apps/web/app/api/v2/me/otc/accept/route.ts: 1 (V-46)
```

The 5 `apps/web/lib/ctf/**` hits are legitimate per the task's whitelist (the
CTF subsystem IS the V-NNN registry). The **3 handler-file hits are NOT**
whitelisted — see M-1 in Findings.

## Build / test / docker

- `pnpm -w run test` → **Test Files 38 passed (38), Tests 191 passed (191)**.
  Matches the commit body's 164 → 191 claim (+5 emit, +14 claim, +8 derive
  = +27 across 3 new test files).
- `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0.
- `pnpm --filter @bvbe/web build` — not re-run; type-only additive changes
  + tsc clean.
- `docker compose ps` → 9/9 up: bitcoin-mock, db (healthy), mock-imds,
  mock-s3, nginx, redis (healthy), web, worker, ws-gateway.
- HTTP smoke: `/api/v2/public/markets` 200, `/api/v2/me/orders/1` 200 with
  flag under CTF_MODE=true; 200 without flag under CTF_MODE=false;
  `/api/v2/ctf/claim` → 200/400 under on, 404 under off.
- `.env` final state: `CTF_MODE=false` (restored).

## Findings

### Blockers
None.

### Majors

- **M-1 (re-introduction of `V-NNN` source comments on handler files):**
  Three slice-1-touched handler files now contain `V-NNN` references in
  comments:
  - `apps/web/app/api/v2/me/orders/[id]/route.ts` (V-4 ×2, V-22)
  - `apps/web/app/api/v2/me/orders/route.ts` (V-25)
  - `apps/web/app/api/v2/me/otc/accept/route.ts` (V-46)

  The slice-10.6 review's N-1 follow-up (commit `835297a`) explicitly
  scrubbed all `V-NNN` mentions from `apps/web/{app,components,lib,styles}`
  precisely because the lab's discovery contract requires planted vulns to
  look like ordinary mistakes — not flagged in code as `// V-4: IDOR ...`.
  The slice-7 L7 review confirmed zero hits at that commit and ratified
  the scrub. Slice 1 reintroduces 4 hits across 3 handler files.

  Architect call required. Two defensible positions:
  (a) **Accept as documentation.** These comments live alongside CTF
  emission, not the plant itself; a careful reader could argue the comment
  documents the *detector*, not the *bug*. Cost: future scrubs need a new
  carve-out, and a trainee reading `me/orders/[id]/route.ts` to understand
  IDOR is told the answer by the comment block.
  (b) **Scrub.** Move the V-NNN identifier into a sibling docstring or
  `docs/phases/phase-11/wiring-map.md` keyed by file:line and remove the
  inline references. Cost: indirection for the staff engineer maintaining
  the wiring map.

  I lean (b) for plant-bearing handlers (V-4, V-22, V-46 owners) and (a)
  for pure detectors (V-25 wired on a non-plant handler). But that's a
  taste call — escalating to architect.

### Minors / Nits

- **N-1 (V-1 proof is too lenient at slice-1 MVP, by design):**
  The commit body acknowledges that V-1 accepts any non-empty exfil tag
  (`PATTERN_B_VALIDATORS["V-1"]` at `claim.ts:32`). Real exfil-tag tracking
  (server emits a known marker when the XSS fires; trainee submits that
  marker) lands slice 2. No action; flag for slice-2 closure.

- **N-2 (V-22 detector is not live-exercisable from seed):** No seeded
  order has `feeTier` of `vip` or `prime`. A trainee has to exploit V-22's
  mass-assign on the PATCH first, then `GET /api/v2/me/orders/<id>` on the
  same order to collect the flag. This is the architect's intended discovery
  loop, but worth flagging that the slice-1 demo path doesn't include a
  one-shot V-22 emit verification — only inspection of source can confirm
  the wiring is right. Tests cover the helper but not the route-level
  integration. Acceptable; integration coverage lands slice 2 or 3.

- **N-3 (V-25 detector path uses a fresh DB query):**
  `apps/web/app/api/v2/me/orders/route.ts:103-105` runs
  `prisma.trade.count({where: {takerOrderId: orderId, takerUserId: claims.sub,
  makerUserId: claims.sub}})` on every order placement, even when CTF_MODE
  is off the query still fires before `maybeEmitFlag` short-circuits.
  Result: one extra Trade table query per `POST /api/v2/me/orders`,
  regardless of CTF_MODE. Functionally benign (the query is cheap and
  indexed-friendly), but it does mean the slice is NOT strictly zero-cost
  when CTF_MODE=false — Architect Condition implicit in plan ("the helper
  is *called* from handlers but the existing logic flow is unchanged")
  is technically violated for V-25's wiring. Architect should decide
  whether to (a) gate the count behind `ctfModeEnabled()` or (b) accept
  the small extra query as the cost of doing business. I'd accept it.

- **N-4 (claim.ts unused-import potential in claim test):** None. The
  three test files are clean — vitest mocks `@/lib/ctf` so the actual env
  module never loads under test. Verified by tsc passing.

## Final verdict and recommendation

**PASS WITH NITS.** Slice 1 ships:

- 40/40 V-NNN plants intact at HEAD.
- 8/8 wired V-NNN exploitable end-to-end under `CTF_MODE=true`, with the
  flag emitted where the architect specified (V-22 on the verification
  step, not the PATCH).
- `CTF_MODE=false` produces byte-identical responses to the pre-slice
  baseline on three representative endpoints; the claim endpoint returns
  404 not 403, matching the spec.
- 191/191 tests, tsc clean, docker 9/9 up.
- Architect Conditions #2 and #5 (the two slice-1-scoped conditions) MET.

M-1 is the only finding that benefits from an architect decision before
slice 2 fans out across 32 more V-NNNs. If the architect rules "scrub,"
slice 2 inherits a tighter wiring contract (move identifiers to a separate
wiring map); if the architect rules "accept," the slice-10.6 scrub
contract needs an explicit carve-out for CTF wiring comments in CLAUDE.md
so a future hygiene-scrub session doesn't tear them out by reflex. Either
ruling is fine; my preference is scrub for plant-bearing handlers, accept
for pure-detector files.

N-1 through N-3 are slice-2 backlog items, not gates on this commit.

`CTF_MODE=false` restored at end of review; docker stack 9/9 up; no source
files outside this review document were modified.
