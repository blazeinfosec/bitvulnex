# Phase 11 — CTF mode: wire the flags

> **2026-05-29 update — see [`spec.md`](./spec.md).** After Gate-1
> approval of this plan, a second design pass added a **two-tier
> hint toggle** to slices 3 and 4. The authoritative scope for
> slices 3 and 4 is now `spec.md`; this `plan.md` remains accurate
> for slices 1 and 2 (emission core + V-NNN fan-out — no hint
> code). The architect's slice-3+4 addendum sits at the bottom of
> `architect-review.md`.

**Theme:** Make the lab's CTF promise real. Today the helper
`apps/web/lib/ctf.ts` exports `flagFor(vulnId)` and `ctfModeEnabled()`,
the env schema accepts `CTF_MODE` + `CTF_SALT`, and an instructor
utility (`scripts/derive-flags.ts`) prints flags for **20 of 40**
V-NNNs when invoked. **None of this is wired into the app.** Zero
call sites for `flagFor` or `ctfModeEnabled` outside the module
itself. A trainee who exploits V-22 (mass-assign role→admin) and
becomes admin gets a normal 200 — no `BVBE{...}` token anywhere.

This phase closes that loop: every planted V-NNN gains a flag
emission point, the 4 killer chains gain chain-completion flags,
trainees see their progress + score on a new `/ctf` page, and
instructors get a `/admin/ctf` console for cohort management.

**Hard rule preserved:** `CTF_MODE=false` is the default. All
emission and detection code paths are dead in default builds.
Blue-team exercises and paranoid-QA re-runs continue to see the
lab exactly as it is today.

## Scope assessment

The lab has been pitched since Phase 0 as supporting "CTF-style
exercises (CTF mode toggleable per cohort)" (`README.md:19`). The
scaffolding was prepared but never finished. Phase 10-revamp made
the *exchange* feel real; phase 11 makes the *CTF* real.

This is a foundational gap. Without it:
- Self-paced training is impossible (no objective success signal).
- CTF events can't run unattended.
- Hackathons can't score participants.
- Blue-team partner programs can't tell who detected what.

The four killer chains in `VULNS.md` are the headline objectives.
Today, "completing CHAIN A" means an instructor watches a screen
share. Phase 11 changes that to: the trainee submits four flags
(one per chain) to `/ctf` and gets visible credit.

**Pedagogically:** Phase 11 transforms BVBE from "lab + lecture"
into "lab + asynchronous practice." A trainee can clone, run, and
self-test against the catalog without any instructor present —
which is the whole point of CTFs.

## Three flag delivery patterns

Different V-NNN categories need different signals. The plan
recognizes three patterns and uses them where they fit:

### Pattern A — Inline emission

The exploit produces a server-side detectable condition; the
response that the trainee receives includes a `_flag` field.

```ts
// apps/web/lib/ctf/emit.ts
export function maybeEmitFlag(payload: object, vulnId: string): object {
  if (!ctfModeEnabled()) return payload;
  return { ...payload, _flag: flagFor(vulnId) };
}
```

Used where the *outcome* of an exploit is visible to the exploiter
without changing the V-NNN's reachability:

- **V-4** — `if (order.userId !== claims.sub) emit V-4` on
  `GET /api/v2/me/orders/[id]`. The plant is the missing filter;
  the emitter sees the same condition and tags the response.
- **V-22** — when `prisma.user.update` writes a field outside the
  legitimate-edit allow-list (`role`, `feeTier`, `status`, etc. on
  Order); emit V-22 on the next `GET /api/v2/me`.
- **V-25** — `if (maker.userId === taker.userId) emit V-25` in
  `matchAgainstBook`.
- **V-43** — when a maker trade lands whose maker order was
  cancelled; emit V-43 on the trade-confirm response.
- **V-46** — when `feeBps === MAKER_FEE_BPS` from header trust;
  emit V-46 on the OTC accept response.
- **V-51** — when `parsed.data.role` is a non-default value on
  `PATCH /api/v2/me`; emit V-51 on the response.
- **V-6** — when `x-bvbe-internal-trace` is non-empty AND auth was
  bypassed; emit V-6 on the internal endpoint response.
- **V-8** — when `verifyAccessToken` accepts an `alg: "none"` JWT;
  emit V-8 on the resulting authed response.
- **V-19** — when the v1 verifier accepts an RS-key-as-HS-secret
  token; emit V-19 on the v1 endpoint response.
- **V-21** — when `refreshToken.create` reuses a previously-consumed
  refresh; emit V-21 on the refresh response.
- **V-32** — when the order-cancel race produces a double-refund;
  emit V-32 in the cancel response.
- **V-40** — when the import-url fetch reaches a
  `metadata.bvbe.internal` / `169.254.0.0/16` host; emit V-40 on
  the import response.
- **V-42** — when a zero-conf deposit is dropped by the keeper
  watcher without compensating debit; emit V-42 on the worker's
  audit row (and the trainee's next deposit list response).
- **V-44** — when a `supplyPositions = findMany(...)` runs after
  `interest` compute and a between-tick position is over-credited;
  emit V-44 on the next lending positions response.
- **V-45** — when `claim.ts` runs concurrent updates without
  predicate guard producing double-claim; emit V-45 on the next
  staking claim.
- **V-47** — when the RBF bump credits with no compensating
  watcher tick; emit V-47 on the bump response.
- **V-23** — on the first WS message after a subscribe whose
  upgrade arrived with no `Origin` header or a non-allowlist
  `Origin`; emit V-23 as a `{ "kind":"ctf", "flag":"BVBE{...}" }`
  message.
- **V-50** — when the upstream `web` Node parser accepts a CL+TE
  smuggled request whose smuggled portion targets a planted route;
  emit V-50 on the smuggled response's body.

Pattern A is the workhorse — covers ~17 V-NNNs.

### Pattern B — Side-channel claim endpoint

Some exploits don't have a clean inline detection point — the
work is on the trainee's side (XSS payload running in the
admin's browser, signed JWT forgery, polyglot construction).
For these, the trainee submits **proof** to:

```
POST /api/v2/ctf/claim
{
  "vulnId": "V-1",
  "proof": "<exploit-specific payload>"
}
```

The server validates the proof against an exploit-specific check
and returns the flag if valid.

- **V-1** — proof = the XSS payload's exfiltrated cookie or
  document.title rewrite. Detector: was an admin's session token
  observed via the planted XSS sink in the last N seconds?
- **V-11/V-12** — proof = the SQL-injected boolean that returned
  rows the safe query wouldn't. Detector: did `$queryRawUnsafe`
  execute with a payload containing telltale tokens (`OR 1=1`,
  `UNION`, etc.) AND CTF_MODE? Add a soft-tracing hook.
- **V-13** — proof = the off-origin URL the redirect landed on,
  including a server-known nonce. Detector: did the trainee load
  the URL with the nonce we issued?
- **V-14** — proof = the contents of `../../etc/passwd` or
  whatever marker file we plant in the upload root.
- **V-17** — proof = the `cmd` from the spawned shell (lab plants
  a `/proc/1/cmdline`-style marker).
- **V-18** — proof = the polyglot HTML upload's reflected
  `onerror=` triggering a server-known callback URL.
- **V-20** — proof = the path-traversed key contents.
- **V-24** — proof = the bech32-with-zero-width that the planted
  normalizer accepted.
- **V-27** — proof = the lex-compared tier that crossed the gate.
- **V-28** — proof = the over-limit withdrawal id whose limit
  check was bypassed by the race window.
- **V-30** — proof = the internal-transfer id that skipped the
  limit check.
- **V-33** — proof = the polyglot PSBT whose finalized output ≠
  validated output. Detector: did the broadcasted tx land funds
  at an attacker output? The bitcoin-mock emits the flag on the
  broadcast response.
- **V-34** — proof = the `?adminPanel=true` reflection on
  `GET /api/v2/me/flags`. Detector: is `flags.adminPanel === true`
  AND the user has no `flags` claim?
- **V-35** — proof = the admin endpoint response that the
  `x-middleware-subrequest` shortcut admitted.
- **V-41** — proof = the polyglot KYC doc that rendered HTML
  in the admin viewer.

Pattern B covers ~14 V-NNNs.

### Pattern C — Self-derivable flags

Some plants are pure recon — git history, lockfile contents,
filesystem layout. There's no runtime "exploit" to trigger; the
discovery itself is the success. For these, the flag is
**deterministic and derivable** from what the trainee learns:

```
flag = BVBE{ sha256("V-NNN:" + <discovered-secret>).slice(0,32) }
```

The trainee finds the secret, hashes it themselves (or pastes into
`/ctf` which hashes for them), and submits.

- **V-9** — `flag = BVBE{ sha256("V-9:changeme")[:32] }`. The
  weak default `JWT_SECRET_LEGACY` IS the secret.
- **V-48** — `flag = BVBE{ sha256("V-48:devsecret-do-not-use-in-prod-bvbe-2026")[:32] }`.
  The leaked `.env.bak` secret.
- **V-49** — `flag = BVBE{ sha256("V-49:@bvbe-internal/observability")[:32] }`.
  The private-scope name from `optionalDependencies`.
- **V-15** — `flag = BVBE{ sha256("V-15:CVE-2023-0842")[:32] }`.
  The discovered CVE id.
- **V-26** — `flag = BVBE{ sha256("V-26:" + utcDate)[:32] }`.
  The calendar-day boundary the limit reset against.

Pattern C covers ~5 V-NNNs. Bonus: `derive-flags.ts` can show
instructors exactly what the trainee must discover.

### Chain-completion flags

Four additional flags, one per killer chain. Detected
server-side by sequencing markers:

- **CHAIN A** — when a treasury broadcast lands BTC at an
  attacker-controlled output reachable via V-48 → V-6 → V-33.
- **CHAIN B** — when a user's `role` flips to `admin` AND their
  JWT was minted via a smuggled `PATCH /api/v2/me`.
- **CHAIN C** — when the liquidation watcher fires a liquidation
  whose triggering price came from a self-trade.
- **CHAIN D** — when synthetic KYC documents from `mock-s3` are
  fetched via the SSRF chain.

Chain flags pay 5× a single-vuln flag in the default scoring
config.

## Slice plan

Each slice is a vertical cut: UI + API + DB + tests + L7 review.
All slices go through the standard four gates.

### Slice 1 — Emission core + reference wiring (1 day)

**Goal:** Establish the architecture, pattern helpers, and prove
the design works end-to-end on a representative sample. Future
slices fan-out cleanly.

**Deliverables:**
- `apps/web/lib/ctf/emit.ts` — `maybeEmitFlag(payload, vulnId)`,
  `maybeEmitWsFlag(socket, vulnId)`, `requireCtfModeOr404(req)`.
  Cheap when `CTF_MODE=false` (single env-flag check, returns
  unchanged payload).
- `apps/web/lib/ctf/claim.ts` — `validateProof(vulnId, proof)`
  registry with per-V-NNN detectors. Initially registers Pattern B
  for V-1, V-11, V-13 as references.
- `apps/web/lib/ctf/derive.ts` — `derivableFlag(vulnId,
  knownInput)` shared with the trainee `/ctf` page so they can
  hash without copying the formula.
- `apps/web/app/api/v2/ctf/claim/route.ts` — POST handler. 404
  when `CTF_MODE=false`.
- Wire Pattern A for: V-4, V-22, V-25, V-46. (Four diverse plants
  across IDOR / mass-assign / engine / header-trust.)
- Wire Pattern B for: V-1, V-13. (XSS + open-redirect — proves
  the proof-validation pattern works for both reflected and
  redirect-class plants.)
- Wire Pattern C for: V-9, V-48. (Two static plants with known
  secrets.)
- Tests: unit tests for each helper; integration tests asserting
  `_flag` present when `CTF_MODE=true` and absent when `=false`.

**Out of scope for slice 1:** All other V-NNN wiring; the `/ctf`
page; admin tools. The point is to validate the seams.

**Exit criteria:**
- 8 V-NNNs emit / accept their flag end-to-end when
  `CTF_MODE=true`.
- Same 8 V-NNNs behave bit-identically to today when
  `CTF_MODE=false` (no `_flag` field, no claim endpoint exposed).
- All 40 V-NNN plants intact (regression spot-check).

### Slice 2 — Fan-out: remaining V-NNNs + chain detectors (2-3 days)

**Goal:** Cover the remaining 32 V-NNN emission/claim points and
the 4 killer-chain detectors. Refresh `derive-flags.ts` to ship
all 44 flags.

**Deliverables:**
- Pattern A wiring for the remaining ~13 inline-detectable
  V-NNNs (V-43, V-51, V-6, V-8, V-19, V-21, V-32, V-40, V-42,
  V-44, V-45, V-47, V-23, V-50).
- Pattern B detectors for the remaining ~12 (V-11, V-12, V-14,
  V-17, V-18, V-20, V-24, V-27, V-28, V-30, V-33, V-34, V-35,
  V-41).
- Pattern C entries for V-15, V-26, V-49.
- 4 chain detectors in the relevant choke points:
  - CHAIN A: `apps/bitcoin-mock/src/rpc/index.ts` broadcast handler.
  - CHAIN B: `apps/web/app/api/v2/me/route.ts` PATCH path observes
    `smuggled-via-V50` request marker (the marker is a header
    nginx adds when the request body framing was ambiguous).
  - CHAIN C: `apps/worker/src/liquidation-watcher.ts` cross-refs
    the triggering trade's `maker.userId === taker.userId`.
  - CHAIN D: `apps/mock-s3/src/server.ts` serve handler tags
    requests originating from `mock-imds` creds.
- Refresh `scripts/derive-flags.ts` to cover all 44 flags (40
  V-NNN + 4 chain). Add `make flags` to Makefile (already
  referenced in instructor docs but not actually defined).
- Per-emitter unit tests asserting on/off behavior. Integration
  tests for each killer chain emitting its flag.

**Exit criteria:**
- All 44 flags emittable (40 plant + 4 chain).
- `pnpm exec tsx scripts/derive-flags.ts` prints all 44.
- `make flags` works as an alias.
- Tests ≥ 200 passing (current 164 + new tests).

### Slice 3 — Trainee /ctf page + scoreboard (1-2 days)

**Goal:** A self-service trainee surface to track progress and
submit flags.

**Deliverables:**
- `apps/web/app/ctf/page.tsx` — main trainee surface. Requires
  auth + `CTF_MODE=true`. Shows:
  - Cohort header (cohort name, salt fingerprint, deadline if set).
  - Score (X/44 flags found; Y/4 chains completed).
  - Submission box (paste `BVBE{...}`; instant validation).
  - Per-target grid (40 plant cards + 4 chain cards) with status
    (unsubmitted / valid / invalid). Locked targets show only
    category + difficulty (not title).
  - Recent submissions log (last 20).
- `apps/web/app/api/v2/ctf/submit/route.ts` — POST validates the
  pasted flag against `flagFor(vulnId, env.CTF_SALT)`; persists
  the (cohortId, userId, vulnId, submittedAt) row.
- `apps/web/app/api/v2/ctf/me/route.ts` — GET trainee progress
  + score.
- `packages/db/prisma/schema.prisma` — new model `CtfSubmission`:
  - `id`, `cohortId`, `userId`, `vulnId`, `flagHashPrefix` (for
    fast-reject without storing salt-derivable secret), `valid`
    (bool), `submittedAt`.
  - Unique index on `(cohortId, userId, vulnId)` so each trainee
    can only score each target once.
- Migration `20260606000000_phase_11_ctf_submissions`.
- Tests + smoke: full submit flow, idempotency, invalid flag
  handling.

**Exit criteria:**
- Trainee can `BVBE{...}` paste and see score update.
- Per-cohort scoreboard accessible via the same `/ctf` page
  (top 20 by score) — opt-in via `CTF_SCOREBOARD_VISIBLE` env.
- Submitting an invalid flag is rate-limited (3/min) and never
  reveals which targets are correct (no oracle).

### Slice 4 — Instructor `/admin/ctf` + cohort tooling (1 day)

**Goal:** Per-cohort lifecycle management for instructors.

**Deliverables:**
- `apps/web/app/admin/ctf/page.tsx` — `requireRole("admin")`:
  - Cohort list (active, archived).
  - Per-cohort scoreboard with CSV export.
  - Reveal-flag override: per-trainee per-V-NNN unlock (when a
    trainee is stuck). Audit-logged.
  - Reset cohort (clears submissions; keeps audit).
- `scripts/new-cohort.sh` — bring up an isolated cohort:
  `docker compose -p cohort-N up -d` with `CTF_SALT=<random>` and
  fresh DB volume. Prints the per-target flag list to a
  cohort-private file.
- Updated `README.md` with the per-cohort workflow.
- Tests for the cohort APIs.

**Exit criteria:**
- Two cohorts can run concurrently with isolated salts and
  scoreboards.
- Instructor can reveal a single flag to a single trainee from
  the UI.
- Phase 11 closeout docs: `architect-review.md`,
  `adversarial-qa.md`, `paranoid-qa.md`.

## Sequencing

Slice 1 → Slice 2 → Slice 3 → Slice 4. Each slice ships through
the standard four gates (architect / staff eng / adversarial QA /
paranoid QA) and lands as a single commit. L7 review per slice as
in phase 10-revamp.

## Risks and mitigations

- **R-1: emission softens a plant.** A poorly-placed
  `maybeEmitFlag` might leak that a vuln-class condition was met
  even when `CTF_MODE=false` (e.g., subtle response shape
  difference). *Mitigation:* `ctfModeEnabled()` short-circuit is
  the FIRST line of every emitter. Paranoid QA in slice 1 will
  diff responses with the env flag on vs off, byte-for-byte, on a
  representative sample.

- **R-2: detection is fragile.** Pattern B's proof validators
  could accept payloads that *look* like exploits but aren't
  (false positives) or reject valid exploits with subtle variation
  (false negatives). *Mitigation:* every detector ships with a
  test that asserts on at least one PoC from
  `docs/phases/phase-N/adversarial-qa.md`. Reuse the killer-chain
  PoCs verbatim where possible.

- **R-3: scoreboard oracle.** A trainee who submits 1000 random
  flags could brute-force the answer space. *Mitigation:* per-IP
  + per-account rate limit (3 submissions/min, 100/day); after
  the daily cap, only valid submissions are accepted.

- **R-4: stale derive-flags.** If `derive-flags.ts` lists V-NNNs
  that aren't actually planted, instructors hand out flags that
  don't validate. *Mitigation:* slice-2 includes a CI check that
  iterates the script's V-NNN list and asserts each appears in
  `VULNS.md`.

- **R-5: chain detection misses partial credit.** A trainee who
  does V-48 + V-6 but stops before V-33 currently gets the V-48
  and V-6 individual flags. CHAIN A flag only when the full
  sequence lands. *Mitigation:* this is by design — chains pay 5×
  for completion, individual flags reward partial progress. Doc
  the scoring rationale in `/ctf` help text.

- **R-6: schema name "flag" collision.** The codebase already
  uses "flag" for *feature flags* (`/api/v2/me/flags`,
  `resolveFlags`, `feature-flags.ts`). *Mitigation:* CTF code
  uses the namespace `ctf` consistently
  (`/api/v2/ctf/*`, `lib/ctf/*`, `CtfSubmission` model). No
  shadowing.

## Hard rules preserved from prior phases

- `CTF_MODE=false` is the default; the env schema's default is
  unchanged.
- `ctfModeEnabled()` is the first line of every emitter and
  detector. No exception.
- Zero new V-NNN. Phase 11 wires existing plants; it does not
  plant new ones. (Paranoid QA in each slice verifies the catalog
  stays at 40.)
- The lab's hard rules (no real PII, no mainnet, no outbound
  third-party calls, banner discipline) are unchanged.
- Phase 10-revamp's pure-frontend discipline is preserved where
  possible — slice 3's `/ctf` page is mostly frontend with one
  new model + 2-3 new routes.

## Exit criteria

When all 4 slices land:

1. All 40 planted V-NNN have a working flag-emit path (Pattern A,
   B, or C).
2. All 4 killer chains have a chain-completion flag.
3. `/ctf` page renders, accepts submissions, scores correctly.
4. `/admin/ctf` page lets instructors run a cohort end-to-end.
5. `make flags` lists all 44 flags for a given `CTF_SALT`.
6. `pnpm test` passes (≥ 200 cases).
7. `pnpm next build` succeeds.
8. `docker compose up -d` brings up 9/9 with `CTF_MODE=true` in a
   throwaway cohort.
9. All 40 plants intact — paranoid QA verifies the catalog
   unchanged at HEAD.
10. README documents the per-cohort workflow.

## Decisions to lock with architect (Gate 1)

1. **Pattern A vs B for borderline cases.** Some V-NNNs could
   work either way (V-22, V-32, V-46). The plan picks Pattern A
   for these; architect should confirm or pivot.
2. **CTF_MODE granularity.** Single global flag, or per-V-NNN
   opt-in? Plan: global. Architect to confirm.
3. **Chain detector storage.** In-memory request markers vs DB
   trail. Plan: in-memory for CHAIN A/D (Redis key with TTL); DB
   trail for CHAIN B/C (audit log). Architect to confirm.
4. **Scoring config.** Plant flags = 1pt; chain flags = 5pt;
   difficulty multipliers? Plan: no multipliers, keep it simple.
5. **`/ctf` page route. ** Top-level `/ctf` vs nested
   `/account/ctf`. Plan: top-level. Trainees are paying for the
   CTF; surface it.
