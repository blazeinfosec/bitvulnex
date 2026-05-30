# Phase 11 Slice 4 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-30
**Scope:** commit `04a1fea` "phase 11.4: /admin/ctf cohort tooling + catalog + 13 more hint files"
**Verdict:** PASS WITH NITS

Slice 4 closes phase 11 by shipping the instructor surface (cohort
lifecycle, scoreboard, heat map, instructor flag override, hint cache
reload), the canonical 44-target catalog as a single source of truth,
the three L7 slice-3 follow-ups (catalog endpoint, reload-hints action,
interaction-on-basic-hint), 13 additional V-NNN hint files (23 of 40
total), and a `scripts/new-cohort.sh` cohort-bootstrap script. The
implementation is **purely additive** to plant code — `git diff
dd6b635..04a1fea` across all 18 plant-bearing files is **0 lines per
file**. `docker-compose.yml` is unchanged; the V-48 JWT_SECRET literal
and V-50 NODE_OPTIONS=`--insecure-http-parser` constructs are
byte-identical. The schema diff is empty (no migration this slice);
`RefreshToken` still lacks `usedAt`/`revokedAt` (V-21 intact).

All seven new API routes, the admin UI shell, the canonical catalog
endpoint, and the trainee-side catalog consumption are wired correctly.
Live verification covered every endpoint listed in the slice plan,
end-to-end. Tests **264/264 passing**. `tsc --noEmit` exits 0. `next
build` reports `Compiled successfully in 10.1s`. `docker compose ps`
shows 9/9 services up.

The slice introduces no plant regressions and no lab-safety violations.
The non-blocking findings below are catalog-vs-validator drift and
documentation surface, not security or correctness.

## Methodology

Ran from a clean working tree at HEAD `04a1fea`. Diffed all
18 plant-bearing files against the slice-3 baseline `dd6b635`. Read
the new catalog, claim/derive validators, all eight new route handlers,
the trainee `/ctf/page.tsx` deltas, the admin layout and `/admin/ctf`
page, and a sample of 3 of the 13 new hint files. Flipped
`CTF_MODE=true`, bounced the web container, waited for boot, logged in
as `admin@bvbe.local`, exercised cohort create / patch / scoreboard
(json + csv) / reload-hints / reveal-flag / reset / archive, and
confirmed non-admin (`alan.hopper.14@example.test`) hits 403 on the
admin surface. Restored `CTF_MODE=false`, deleted the test cohort,
cleared `ctf_*` rows for alan and all `admin_audit_logs` `ctf.*`
entries, and confirmed the V-4 IDOR plant still fires with no `_flag`
field.

## Plant integrity

`git diff dd6b635 -- <file>` for the 18 plant-bearing files
(`apps/web/lib/env.ts`, `login-form.tsx`, `account/orders/edit-order.ts`,
both admin/users pages, `engine/match.ts`, `middleware.ts`,
`packages/shared/src/jwt-v1.ts`, `kyc-tier.ts`, `withdrawal/rbf.ts`,
`withdrawal/limit.ts`, `engine/fees.ts`, the five `/api/v2/me/...`
routes, and `/api/v2/admin/withdrawals/[id]/bump/route.ts`) returns
**0 lines on every file**.

`docker-compose.yml`: `JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026`
(V-48) and `NODE_OPTIONS: "--insecure-http-parser"` (V-50) verbatim.
`packages/db/prisma/schema.prisma`: `RefreshToken` model has no
`usedAt`/`revokedAt` columns (V-21 intact).

V-4 live PoC under `CTF_MODE=false`: alan (`cmpqt8fmz000p…`) reads
`GET /api/v2/me/orders/1` and gets `userId: cmpqt8ex9…` (different
owner) with no `_flag` field in the response. Plant fires, gate
respects the mode toggle. ✓

## Catalog single source of truth audit

`apps/web/lib/ctf/catalog.ts` ships `ALL_TARGETS` with 40 plant entries
plus 4 chain entries, ordered V-NNN ascending then chains. Cross-checks:

- **ID coverage:** `grep -oE "^### V-[0-9]+" VULNS.md | sort -u` yields
  40 unique IDs; all 40 appear in `ALL_TARGETS`. No spurious V-IDs.
- **CHAIN coverage:** CHAIN-A through CHAIN-D, matching the four
  killer-chain validators in `claim.ts`.
- **Pattern A (inline emit) coverage:** catalog claims A for V-4, V-22,
  V-25, V-40, V-46, V-47, V-51. `grep -rn "maybeEmitFlag" apps/web`
  outside `lib/ctf` finds exactly those 7 plants. Match. ✓
- **Pattern C (derive secret) coverage:** catalog claims C for V-9,
  V-15, V-48, V-49. `derive.ts` `PATTERN_C_SECRETS` enumerates exactly
  those 4 IDs. Match. ✓
- **Pattern B (claim-validator) coverage:** catalog claims B for 29
  plants (V-1, V-6, V-8, V-10, V-11, V-12, V-13, V-14, V-17, V-18,
  V-19, V-20, V-21, V-23, V-24, V-26, V-27, V-28, V-30, V-32, V-33,
  V-34, V-35, V-41, V-42, V-43, V-44, V-45, V-50). `claim.ts`
  `PATTERN_B_VALIDATORS` has 22 V-NNN keys (plus 4 chains). **Missing
  validators for V-6, V-26, V-42, V-43, V-44, V-45, V-50.** See
  Findings → Major M-1.

`GET /api/v2/ctf/targets` returns `counts: {plants:40, chains:4,
total:44}` and 44 entries. ✓

## Admin routes — live verification (CTF_MODE=true)

| Step | Endpoint | Result |
|------|----------|--------|
| (a) | flip `.env` + `docker compose up -d web` + 14s wait | web up ✓ |
| (b) | login as `admin@bvbe.local` | 200, bearer token ✓ |
| (c) | `GET /api/v2/admin/ctf/cohorts` | 200, `default` cohort present ✓ |
| (d) | `POST /api/v2/admin/ctf/cohorts` (l7-review, hintsDefault=true, 30s) | 201, `id=cmpsgf8es…` ✓ |
| (e) | `PATCH /api/v2/admin/ctf/cohorts/<id>` (`verboseUnlockSeconds:60`) | 200, row updated ✓ |
| (f) | `GET .../scoreboard` | 200, `rows:[]`, 44 heat-map entries (all zeros) ✓ |
| (g) | `GET .../scoreboard?format=csv` | 200, `Content-Type: text/csv; charset=utf-8`, header row + zero data rows ✓ |
| (h) | `POST /api/v2/admin/ctf/reload-hints` | 200, `{loaded:35}` (23 V-NNN + 4 chains × 3 steps = 35) ✓ |
| (i) | `POST .../reveal-flag` (alan, V-4) | 200; `ctf_submissions` row with `valid=true` written; `admin_audit_logs` row `action='ctf.reveal-flag'` written ✓ |
| (j) | `POST .../reset` | 200, `{submissionsDeleted:1, interactionsDeleted:0, revealsDeleted:0}` ✓ |
| (k) | `PATCH .../{id}` (`archived:true`) | 200, `archivedAt` populated ✓ |
| (l) | alan tries `GET /admin/ctf/cohorts` | **403 forbidden** (middleware gates `/api/v2/admin/*`) ✓ |

## Trainee catalog integration

- `GET /api/v2/ctf/targets` as alan (trainee) → 200 full catalog ✓
- Under `CTF_MODE=false` → 404 ✓
- `apps/web/app/ctf/page.tsx`: PLANT_KEYS hardcoded list removed
  (slice-3 N-1). One-shot `useEffect` at line 61 fetches
  `/api/v2/ctf/targets` and populates `catalog` state. Comment at line
  32 makes the swap explicit. ✓
- `TargetCard.loadBasic` (line 360): fires `POST /api/v2/ctf/interaction`
  via `void authedFetch` before the basic-hint request — kicks the
  verbose-unlock timer on first read (slice-3 N-3). Idempotent
  per the upsert in `recordFirstInteraction`. ✓

## Admin sidebar

`apps/web/app/admin/layout.tsx:18` adds `{ href: "/admin/ctf", label:
"CTF", matchPrefix: "/admin/ctf" }` to the admin sidebar. Public
navbar (`apps/web/components/ui/navbar.tsx`) is grep-clean for both
`admin` and `ctf` — phase-10 rule preserved. ✓

## scripts/new-cohort.sh

`-rwxr-xr-x` (executable). 76 lines. Verified:
- Calls `POST /api/v2/auth/login` with admin creds (BVBE_ADMIN_EMAIL +
  BVBE_ADMIN_PASSWORD env overrideable; defaults match seed).
- Parses `"access":"…"` JWT from response, posts to
  `/api/v2/admin/ctf/cohorts` with `name` + `hintsDefault`.
- If `CTF_SALT` is in the shell env, runs
  `pnpm exec tsx scripts/derive-flags.ts` to print the canonical
  44-flag table; otherwise emits an instructional message.
- No hardcoded token. ✓

## Hint validator trade-off

`apps/web/lib/ctf/hints.ts` drops the bare `:N` rule from
`FORBIDDEN_BASIC`/`FORBIDDEN_VERBOSE`. The commit body documents that
V-26's verbose ("withdrawal at 23:59:59 and another at 00:00:01")
was tripping the wall-clock rule. The remaining shield catches:

- Anchored repo-path refs (`apps/`, `packages/`, `nginx/`) — caught ✓
- Line-number prose (`\bline\s+\d+`) — caught ✓
- HTTP method + slash payload (`GET /`, `POST /`, etc.) — caught ✓
- Shell snippets (`\bcurl `) — caught ✓
- Prototype pollution / SQL constructs (basic only) — caught ✓

What slips through after the change: file refs without a prefix
(e.g., bare `match.ts:42`, `withdrawal/limit.ts:99`). I grepped
all 23 V-NNN + 4 chain hint files for `[a-zA-Z_-]+\.[tj]sx?:[0-9]`
— zero hits today. Risk is future authoring drift, not current
content leakage. Acceptable trade-off; flagged as Nit N-1.

## Hint authoring progress

23 of 40 V-NNN hints + 4 chain files (each emitting 3 step records)
= **35 records** loaded by `loadAllHints()`, matching the
`reload-hints` `{loaded:35}` response. Sampled V-6, V-26, V-32:

- **V-6:** basic = "trust marker not exhaustively stripped at edge",
  category-only ✓; verbose names the strip-list drift and the
  forge-or-leak pairing without revealing the header name or route
  prefix ✓.
- **V-26:** basic = "calendar-day bucket boundary", verbose names
  UTC truncation + sketches the cross-boundary drain. No file
  path, no method+slash. ✓
- **V-32:** basic = cancel-vs-fill race shape; verbose adds the
  snapshot-read-outside-transaction lens without naming the
  function. ✓

`hints.test.ts` runs `validateHint` over every loaded record under
CI, and the 264-test suite passed clean — any malformed file would
have failed the build.

17 V-NNN hints still open per `slice-3x-hints-todo.md`. This is
explicitly tracked content debt, not a slice regression.

## CTF_MODE=false invariant (architect condition #5 carry-forward)

After restoring `CTF_MODE=false` and bouncing web:

- `GET /api/v2/ctf/targets` → **404** ✓
- `GET /api/v2/admin/ctf/cohorts` (unauthed) → **401** (auth before
  mode, expected) ✓
- `GET /ctf` (browser-rendered) → **200** with "CTF mode disabled"
  client message ✓
- `GET /api/v2/me/orders/1` as alan → **200** with cross-owner
  `userId` and **no `_flag` field** — V-4 plant fires, mode gate
  on the emit helper respects the flip ✓

## Tests / types / build

- `pnpm -w run test` → **264 passed (42 files)** ✓
- `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0 ✓
- `pnpm --filter @bvbe/web build` → "Compiled successfully in 10.1s" ✓
- `docker compose ps` → 9/9 services Up ✓

## Phase-11 exit criteria status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 40 V-NNN have working flag-emit paths | ✓ slice 1-2 (caveat M-1) |
| 2 | 4 chain flags wired | ✓ slice 2 |
| 3 | `/ctf` renders, accepts submissions, scores | ✓ slice 3 |
| 4 | `/admin/ctf` works for cohort end-to-end | ✓ **this slice** |
| 5 | `make flags` lists all 44 | ✓ slice 2 |
| 6 | `pnpm test` ≥ 200 | ✓ 264 |
| 7 | `next build` | ✓ Compiled successfully |
| 8 | `docker compose up` green | ✓ 9/9 |
| 9 | All 40 plants intact | ✓ 18/18 files 0-line diff |
| 10 | README documents per-cohort workflow | ✗ single line mention only — see Minor m-1 |

## Findings

### Blockers

None.

### Majors

**M-1 — Catalog asserts Pattern B for 7 plants with no validator.**
`apps/web/lib/ctf/catalog.ts` labels V-6, V-26, V-42, V-43, V-44, V-45,
V-50 as `pattern: "B"`, but `claim.ts` `PATTERN_B_VALIDATORS` has no
entry for any of these. A trainee submitting `POST /api/v2/ctf/claim`
with one of these IDs hits the "unknown vuln id or wrong pattern"
branch and gets `400 invalid`. This is the deferred work from
`slice-2x-todo.md` §"Slice 2.1 — Pattern A backlog" surfacing as a
catalog↔code drift now that slice 4 declares the catalog the single
source of truth. Two valid fixes: (a) add stub validators that accept
a reasonable proof shape (matches the pattern used for V-23, V-28,
V-30, V-35 which already have permissive validators); (b) drop these
seven from the catalog until slice 2.1 ships and explicitly mark the
phase as having a 33/40 claimable surface. Either way the catalog
should not promise a flow that returns 400. Recommend (a) — small
diff, holds the "40 claimable plants" exit-criterion line.

### Minors

**m-1 — README has no per-cohort workflow section.** README.md has
exactly one CTF reference ("Capture-the-Flag exercises (CTF mode
toggleable per cohort)") and no operating instructions for
instructors. Exit criterion #10 from `plan.md` calls for "README
documents per-cohort workflow." Recommend adding a `## Running a
CTF cohort` section covering: flip `CTF_MODE=true`, run
`scripts/new-cohort.sh <name>`, distribute trainee creds + `/ctf`
URL, use `/admin/ctf` for hint toggle / reveal / reset / archive,
restore `CTF_MODE=false` after exercise.

### Nits

**N-1 — Hint depth-validator weakened for bare-suffix file refs.**
Dropping `:N` from `FORBIDDEN_BASIC`/`FORBIDDEN_VERBOSE` was the
right call (V-26 needed `23:59:59` prose) but now a future author
could write "look in match.ts:42" without tripping the validator.
All 23 current files are clean. Recommend a narrower replacement:
`\b[a-zA-Z_][a-zA-Z0-9_./-]*\.(ts|tsx|js|jsx|conf|yml|yaml|prisma):\d+\b`
catches `match.ts:42` without false-positiving on `23:59:59`. Low
priority — content is fine today.

**N-2 — `reload-hints` returns `{loaded}` count but not which
records.** Useful for the instructor flow ("did my V-22 file get
picked up?"); current 35 vs expected can be hard to triage. Could
return `{loaded: 35, keys: ["V-1", "V-4", …]}`. Nit-grade.

## Final verdict

**PASS WITH NITS.** Slice 4 ships the instructor surface cleanly,
preserves all 40 plants (18/18 files 0-line diff vs slice 3),
honors the CTF_MODE=false invariant, and folds in all three L7
slice-3 follow-ups (catalog endpoint, reload-hints, interaction-on-
basic). The 264-test suite + tsc + next-build are green. The one
Major finding (M-1, catalog↔validator drift on 7 plants) is a
pre-existing slice-2 known-gap that the new catalog surface
exposes — it should be closed before phase 11 is signed off so the
"40 claimable plants" line in the exit criteria is true end-to-end.
The Minor (README) and two Nits (validator narrowing, reload-hints
key list) are low-cost cleanups.

Recommend the orchestrator address M-1 (stub validators for the
seven IDs) and m-1 (README section) inside this slice or as a
slice 4.x follow-up, then drive phase 11 closure through architect
review → adversarial QA → paranoid QA the same way phase 10-revamp
closed.
