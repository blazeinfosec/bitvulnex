# Phase 11 Slice 3 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-30
**Scope:** commit `5e9f83f` "phase 11.3: trainee /ctf page + cohort + hint engine"
**Verdict:** PASS WITH NITS

Slice 3 closes the loop from "trainee can submit a flag" to "trainee can also
ask for a two-tier hint when stuck and see their score." The slice ships three
DB models (`Cohort`, `CtfSubmission`, `CtfInteraction`, `CtfHintReveal` plus a
`HintsOverride` enum), four helper modules (`cohort.ts`, `interaction.ts`,
`hints.ts`, `submit.ts`), five new `/api/v2/ctf/*` route handlers, a
client-rendered `/ctf` trainee page, and ten V-NNN + four CHAIN hint files
under `docs/hints/`. The implementation is **purely additive** — `git diff
b8ec351..5e9f83f` over all 18 plant-bearing files is 0 lines on every file,
and `docker-compose.yml` carries exactly one line of change (the new
`./docs/hints:/repo/docs/hints:ro` bind mount). The V-48 JWT_SECRET literal
and V-50 NODE_OPTIONS=`--insecure-http-parser` constructs are byte-identical
to the slice-2 baseline. The schema diff is additive only — `RefreshToken`
remains without `usedAt`/`revokedAt` (V-21 plant intact, confirmed via
psql column-name probe).

All four architect addendum conditions land correctly: #6 the depth validator
runs in CI via `hints.test.ts` (12 tests); #7 `hintsAllowedFor` is the SOLE
gate for every hint-emitting path (the `hints/[target]` handler consults it
BEFORE loading markdown AND BEFORE writing the reveal row); #8 the
`/ctf/me` payload filters reveals by `where: { cohortId, userId: claims.sub }`
so no aggregate of peers leaks; #9 `recordFirstInteraction` uses a single
`prisma.ctfInteraction.upsert` against the unique index — never a
find-then-create race. The forbidden-substring regex on the validator
correctly rejects file paths, CVEs (basic-only), `__proto__`, `prisma.`,
`$queryRaw`, `curl `, line numbers, `:nnn` line refs, and HTTP-method+slash
payload shapes. Live grep across all 14 authored hint files turns up
zero forbidden-pattern hits.

Tests **264/264 passing** (+30 over slice 2). `tsc --noEmit` exits 0.
Docker stack 9/9 up. Live verification under CTF_MODE=true: cold `/ctf/me`
auto-creates a `default` cohort with `hintsDefault=false`; basic hint with
`follow + cohort=off` → 403 `cohort-default-disabled`; `PATCH /hints-override
{enable}` → 200, then basic V-4 → 200 category-only prose and a
`CtfHintReveal` row written; verbose without interaction → 425
secondsRemaining=900; POST `/interaction` writes the `CtfInteraction` row;
shrinking `verboseUnlockSeconds` to 1 + a 3s wait → verbose returns 200 with
prose distinct from the basic tier. The salt-derived V-4 flag
`BVBE{a6b6182b…6f0f}` validates → `valid:true`, `plantFlags=1`. Re-submit is
idempotent (still 1). Wrong flag → `valid:false` with **no canonical-flag
echo**, `plantFlags` unchanged. `/ctf` page returns HTTP 200 (client-rendered;
PLANT_KEYS array enumerates 40 V-NNN client-side).

Under CTF_MODE=false: all six `/api/v2/ctf/*` endpoints return 404; the V-4
IDOR plant on `/api/v2/me/orders/{1..5}` still fires (alan reads other users'
rows) with zero `_flag` occurrences.

Two non-blocking findings worth architect attention: (1) the 10-of-40
hint coverage gap is documented in the commit body as a content-only
follow-up and the loader gracefully 404s "unknown target" for the other 30
— acceptable scope discipline; (2) the `loadAllHints` module-level cache
combined with read-only-bind-mounted markdown means hot edits to hint
content require a `docker compose restart web` — minor DX friction.

## Methodology

- Read commit body in full; compared stated scope to spec.
- `git diff b8ec351..5e9f83f --name-only` → 30 files. New: 5 routes, 1 page,
  3 lib helpers + 3 unit-test files, 14 hint markdown files + README,
  1 SQL migration. Modified: 2 (`docker-compose.yml` +1 line bind mount;
  `schema.prisma` additive only).
- Plant-file empty-diff probe: `for f in <18 files>; do git diff b8ec351..5e9f83f -- $f | wc -l; done` → all 0.
- `grep -n 'JWT_SECRET\|insecure-http-parser' docker-compose.yml` → V-48 + V-50 lines verbatim.
- Verified `RefreshToken` lacks `usedAt`/`revokedAt`: `SELECT "usedAt"…` returns
  `ERROR: column "usedAt" does not exist`. V-21 plant intact.
- Read 4 helper modules (`cohort.ts`, `interaction.ts`, `hints.ts`,
  `submit.ts` route), 5 route handlers, and the `/ctf/page.tsx` first 60
  lines (client component, PLANT_KEYS enumeration).
- `pnpm -w run test` → **42 files, 264/264 tests**.
- `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0.
- `docker compose ps` → 9/9 up.
- `psql \dt` → 4 new tables present (`cohorts`, `ctf_submissions`,
  `ctf_interactions`, `ctf_hint_reveals`). `users` has `cohortId` +
  `hintsOverride` columns.
- `SELECT count(*) FROM cohorts;` → 1 row (auto-created `default` cohort
  visible from cold).
- Flipped `.env` CTF_MODE → true; `docker compose up -d web`; 14s settle.
  Walked the e2e flow (a)–(j) as specified. Restored CTF_MODE=false at end;
  cleared `ctf_submissions / ctf_hint_reveals / ctf_interactions`; reset
  alan's `hintsOverride='follow'` and `cohortId=NULL`.
- `grep -iE "apps/|packages/|nginx/|CVE-|__proto__|prisma\.|\\\$queryRaw|curl |line [0-9]+|GET /|POST /|PATCH /|DELETE /|:[0-9]+" docs/hints/*.md` → 0 hits across 14 files.

## Plant integrity (all 40 V-NNN)

18 plant-bearing files inspected via empty-diff; the 22-file plant union
from slice 2 carries forward. Docker-compose `JWT_SECRET` (V-48) and
`NODE_OPTIONS=--insecure-http-parser` (V-50) literals unchanged.

| Plant surface | Status at HEAD |
|---|---|
| All 18 explicit plant files (env.ts, login-form.tsx, edit-order.ts, admin/users[/id]/page.tsx, match.ts, middleware.ts, jwt-v1.ts, kyc-tier.ts, rbf.ts, limit.ts, fees.ts, me/route.ts, kyc/import-url, me/orders/[id], me/otc/accept, me/orders, admin/withdrawals/[id]/bump) | **0-line diff vs b8ec351** |
| docker-compose.yml V-48 JWT_SECRET line (L30, L103) | **Verbatim** |
| docker-compose.yml V-50 NODE_OPTIONS=--insecure-http-parser (L36) | **Verbatim** |
| docker-compose.yml only-other-change: +1 line ./docs/hints bind-mount RO | Additive only |
| schema.prisma RefreshToken (V-21 plant — no usedAt/revokedAt) | **Intact** (psql column probe confirms absent) |
| schema.prisma diff | Additive only — new fields + 4 models + 1 enum |
| /api/v2/me/orders/{1..5} as alan (V-4 IDOR) under CTF_MODE=false | **Plant fires**, zero `_flag` |

**Net: 40/40 plants intact. No regression. No softening.**

## Architect addendum conditions

**#6 — Hint depth validator runs in CI, not at runtime.**
`apps/web/lib/ctf/__tests__/hints.test.ts` contains 12 test cases that
exercise `validateHint`, including positive (well-formed record) and
negative (empty / >200 / >600 / file path / CVE / curl payload / line
numbers). The "authored exemplars pass the validator" suite re-runs
`loadAllHints()` which validates every file as it parses, so a malformed
hint ships as a CI failure not a runtime 500. Verified by `pnpm -w run
test` → 264/264 passing, hints suite included. ✅

**#7 — `hintsAllowedFor` is the SOLE gate for hint-emitting paths.**
`apps/web/app/api/v2/ctf/hints/[target]/route.ts` calls
`hintsAllowedFor(claims.sub)` at L47, gates `403 forbidden` at L48-53
BEFORE `loadHint()` (L74) and BEFORE the `prisma.ctfHintReveal.upsert`
(L80). The function itself short-circuits on `!ctfModeEnabled()` at
`cohort.ts:95` so production paths are zero-cost. Live test: with cohort
default=off + user=follow → 403 `cohort-default-disabled` and **no reveal
row written** (verified empty SELECT before the override flip). ✅

**#8 — `CtfHintReveal` is logged-only on the trainee surface.**
`apps/web/app/api/v2/ctf/me/route.ts:74-77` filters reveals with
`where: { cohortId, userId: claims.sub }` — no aggregate path, no peer
counts. The schema comment on the model itself flags "Aggregates are
admin-only — never exposed on a trainee surface" (schema L887-890). Reveal
events do NOT increment score (score is built from `CtfSubmission` only,
L86-90 of the route). ✅

**#9 — `recordFirstInteraction` is atomic.**
`apps/web/lib/ctf/interaction.ts:19-26` uses `prisma.ctfInteraction.upsert`
against the `(cohortId, userId, targetKey)` unique constraint; the `update`
branch is `{}` so `firstAt` cannot be overwritten. No `findUnique →
create` race. ✅

## Live verification (CTF_MODE=true, alan.hopper.14)

| Step | Expectation | Result |
|---|---|---|
| (a) Cold `GET /ctf/me` | Default cohort, hintsDefault=false, score 0/40 + 0/4 | `{cohort:{name:"default",hintsDefault:false,verboseUnlockSeconds:900},hints:{userOverride:"follow",effective:false},score:{plantFlags:0,chainFlags:0,plantTotal:40,chainTotal:4}}` ✅ |
| (b) `GET /hints/V-4?tier=basic` | 403 reason cohort-default-disabled | `{error:{message:"forbidden",reason:"cohort-default-disabled"}}` HTTP 403 ✅ |
| (c) `PATCH /me/hints-override {enable}` then basic | 200 + category-only prose + reveal row | `{targetKey:"V-4",tier:1,category:"OWASP / Access control / IDOR",text:"…"}` HTTP 200; reveal row present ✅ |
| (d) `?tier=verbose` (no interaction yet) | 425 secondsRemaining | `{error:{message:"too early",secondsRemaining:900}}` HTTP 425 ✅ |
| (d') `POST /interaction {V-4}` then check `ctf_interactions` | Row written with firstAt | 1 row, firstAt timestamp ✅ |
| (e) `UPDATE cohorts SET verboseUnlockSeconds=1` + 3s + retry verbose | 200, distinct prose | Verbose returns 425-character lens-prose; distinct from basic ✅ |
| (f) Submit `BVBE{a6b6182b…6f0f}` (V-4 flag) | valid:true, plantFlags→1 | `{valid:true,targetKey:"V-4"}`; `/me` score plantFlags=1 ✅ |
| (g) Resubmit same flag | idempotent | `{valid:true}`, plantFlags still 1 ✅ |
| (h) Submit wrong flag | valid:false, no canonical echo | `{valid:false,targetKey:"V-4"}`; plantFlags=1 unchanged; no `flag` key in response ✅ |
| (i) `GET /ctf` | HTTP 200 trainee page | 200, client-rendered (PLANT_KEYS enumerates 40 V-NNN client-side) ✅ |

**Oracle defenses verified:**
- Submit endpoint does NOT echo the canonical flag on miss (route L97-100
  documents this explicitly).
- `/ctf/me` reveals/interactions filtered to `userId: claims.sub` only.
- Hint endpoint returns 403 before `loadHint()` when policy disallows.

## CTF_MODE=false invariant

After flipping `.env` `CTF_MODE=false` + `docker compose up -d web` + 14s
settle:

| Endpoint | Expectation | Result |
|---|---|---|
| `POST /api/v2/ctf/submit` | 404 | ✅ 404 not found |
| `GET /api/v2/ctf/me` | 404 | ✅ 404 not found |
| `PATCH /api/v2/ctf/me/hints-override` | 404 | ✅ 404 not found |
| `POST /api/v2/ctf/interaction` | 404 | ✅ 404 not found |
| `GET /api/v2/ctf/hints/V-4` | 404 | ✅ 404 not found |
| `POST /api/v2/ctf/claim` | 404 | ✅ 404 not found |
| `GET /api/v2/me/orders/{1..5}` as alan (V-4 IDOR) | Plant fires; no `_flag` | ✅ all 5 return 200 with peer order data; `grep -c _flag` = 0 on each |

## Tests & types

- `pnpm -w run test` → **42 files, 264/264 tests** (+30 from slice 2's 234).
  Three new suites: `cohort.test.ts`, `hints.test.ts`, `interaction.test.ts`.
- `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0.
- `docker compose ps` → 9/9 up at final state.
- DB final state: 0 rows in `ctf_submissions`, `ctf_hint_reveals`,
  `ctf_interactions`; alan `hintsOverride=follow`, `cohortId=NULL`.

## Hint depth validator audit

`apps/web/lib/ctf/hints.ts:57-60` defines:

```
FORBIDDEN_BASIC   = apps/| packages/| nginx/| CVE-| __proto__| prisma.| $queryRaw| \bcurl | \bline\s+\d+ | \bGET \/ | \bPOST \/ | \bPATCH \/ | \bDELETE \/ | :\d+\b
FORBIDDEN_VERBOSE = (same minus CVE-, which verbose may mention for V-15)
```

Grep over all 14 authored hint files for each forbidden substring → **zero
hits**. Spot-check of edge cases:

- V-13 `"leading slash or for protocol-relative shapes"` — phrase "leading
  slash" does not match `\bGET \/`-style regex. Passes correctly.
- V-22 mentions "fee tier and order status" — column-name shape, not file
  path. Passes correctly.
- CHAIN-A `"a single missing line is enough"` — "line" without trailing
  digit does not match `\bline\s+\d+`. Passes correctly.
- CHAIN-B verbose mentions `Content-Length` and `Transfer-Encoding` as
  header names — not blocked. Acceptable; these are lens-level cues.
- V-51 verbose names `role`, `kycTier`, `feeTier` as field names — column
  names, not paths. Acceptable.

The validator is appropriately tight. One borderline call worth flagging
(N-1 below): the verbose regex's `:\d+\b` line-ref check would not catch a
hint that says "around the role: assignment" — but no authored hint comes
close. Defensive enough for slice-3 content scope.

## Findings

### Blockers

None.

### Majors

None.

### Minors

**N-1 (10/40 hint authoring coverage — documented gap):** Slice 3 ships hint
files for 10 V-NNNs + 4 chains = 22 step-keyed records via the loader. The
other 30 V-NNNs return `{"error":{"message":"unknown target"}}` HTTP 404 from
`/api/v2/ctf/hints/{target}`. The commit body explicitly defers these as a
"content-only follow-up (no code change required)." The trainee UI surfaces
this gracefully (the hint button reveals a "no hint authored yet" miss). I'm
calling this acceptable scope discipline — the loader, validator, and
authoring guide are all in place, so the follow-up is content-write only.
**Action:** add a `docs/phases/phase-11/slice-3x-hints-todo.md` listing the
30 unauthored V-NNNs so the gap doesn't get lost between slices.

**N-2 (`loadAllHints` cache + RO bind-mount = no hot-reload):**
`hints.ts:180` uses a module-level `CACHE: Map | null` populated on first
`loadAllHints()`. Combined with the read-only docker bind-mount at
`./docs/hints:/repo/docs/hints:ro`, this means an instructor editing a hint
file mid-class needs `docker compose restart web` to see the change. The
exported `clearHintCache()` exists but no route calls it. **Action:** in
slice 4, either expose a small admin-only "reload hints" endpoint or drop
the cache (filesystem reads are cheap and bounded — 14 files today, ≤44 at
saturation). Today's behavior matches the spec but is a DX papercut.

**N-3 (verbose request without prior interaction always reports unlock
window as `verboseUnlockSeconds`):** When no `CtfInteraction` row exists,
`verboseUnlockedFor` (`interaction.ts:52`) returns `secondsRemaining:
unlockSecs` (the cohort's full window). The UI may want to display "click
to start the unlock timer" instead of "15 minutes remaining". The handler
also does NOT auto-create the interaction on a verbose-hint request — the
trainee must call `POST /interaction` first. Reasonable separation of
concerns (the hint endpoint shouldn't side-effect timers without explicit
intent) but worth a UX call: the `/ctf` page should issue a single
`POST /interaction` when the trainee first opens a target card so the
timer starts. Verify in slice 4 UI polish.

### Nits

**Nit-1 (`/ctf/me` returns reveals + interactions array uncapped):** Both
`reveals` and `interactions` payload arrays in `me/route.ts:74-81` are
returned without a `take:` limit. At cohort saturation (~44 records each),
fine. At a multi-cohort archive view this could grow. The submissions
query at L52 is correctly capped at `take: 200`. Cosmetic.

**Nit-2 (`PLANT_KEYS` hardcoded in `/ctf/page.tsx`):** The page enumerates
40 V-NNNs as a literal array (lines 32-41). The server already knows the
full catalog via `flagFor`/`expectedSecretFor`. **Action:** in slice 4,
expose a `GET /api/v2/ctf/targets` endpoint returning the catalog so the
trainee UI doesn't drift from `VULNS.md`. Today's behavior is correct;
drift risk is the concern.

**Nit-3 (CtfSubmission unique `(cohort,user,target,valid)` semantic):**
The unique index lets a wrong-then-right sequence yield two rows (one
`valid=false` + one `valid=true`). Submitting wrong twice is upsert-updated
in place (same row, `submittedAt` refreshed). Submitting wrong → right →
wrong leaves both rows. Acceptable, but the `attempts` count in
`/ctf/me` (sum of all submissions) can therefore double-count
in unintuitive ways. Cosmetic; flag for slice 4 admin-UI work.

## Final verdict and recommendation

**PASS WITH NITS.** Slice 3 ships:

- 40/40 V-NNN plants intact at HEAD (18-file plant union empty-diff
  vs `b8ec351`; V-48/V-50 docker constructs verbatim; V-21
  RefreshToken-without-usedAt confirmed via psql).
- Purely additive schema change (4 new models + 1 enum + 3 cols on User).
- 4/4 architect addendum conditions (#6–#9) satisfied with code-level
  verification.
- 5 new `/api/v2/ctf/*` routes; all 6 (including slice-1 `claim`) return
  404 under CTF_MODE=false.
- Live e2e walk (a)–(j) all green: cold cohort auto-creation, 403/200/425
  hint state machine, verbose-unlock arithmetic, idempotent submit,
  no-oracle wrong-flag behavior.
- Hint depth validator rejects file paths, line numbers, CVE refs (basic),
  payload shapes; all 14 authored hints pass.
- Tests 234 → 264 (+30); tsc clean; docker 9/9.

Three non-blocking nits for slice 4 (hint authoring backlog, cache
hot-reload, /ctf catalog endpoint). No M-level or Blocker findings.

`CTF_MODE=false` restored at end of review; alan's `hintsOverride='follow'`
and `cohortId=NULL`; `ctf_submissions / ctf_hint_reveals / ctf_interactions`
all empty; docker stack 9/9 up; no source files outside this review
document were modified.
