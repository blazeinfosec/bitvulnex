# Spec: BVBE phase 11 — CTF flags + two-tier hint toggle

## Context

The lab's CTF promise (`README.md:19`: "CTF mode toggleable per cohort")
is unfulfilled at HEAD. `apps/web/lib/ctf.ts` exports a `flagFor()`
helper and an env-flag check; `scripts/derive-flags.ts` prints flags
for 20 of 40 V-NNNs; **zero call sites** in the running app emit or
accept a flag. A trainee who exploits V-22 today gets a normal 200 —
no `BVBE{...}` feedback. Self-paced training, unattended hackathons,
and per-cohort scoring are all impossible.

Phase 11 closes the loop in two intertwined ways:

1. **Flag wiring (already locked):** three delivery patterns
   (inline / claim-endpoint / self-derivable) emit `BVBE{...}` tokens
   to trainees when an exploit's server-side condition fires. 4
   killer-chain bonus flags. A new trainee `/ctf` page accepts
   submissions and shows score. New `Cohort` model + `CtfSubmission`
   model. Existing plan at `docs/phases/phase-11/plan.md` and Gate-1
   architect approval at `docs/phases/phase-11/architect-review.md`.

2. **Hint toggle (this spec):** a two-tier hint system layered on
   top of the flag infrastructure, scoped per-cohort with per-trainee
   override. Hints are LOGGED but do NOT affect scoring; instructors
   see hint analytics in cohort post-mortems. New cohorts ship with
   hints OFF.

Hard rule preserved: when both `CTF_MODE=false` AND hints disabled,
the running app behaves exactly as today. Blue-team exercises and
paranoid-QA re-runs see no diff.

## Locked design decisions (from 2026-05-29 interview)

| Axis | Decision |
|------|----------|
| Hint depth (most explicit) | Two tiers: **basic = category-only**, **verbose = lens + category mix** |
| When hints surface | Basic: **available pre-attempt** (free study mode). Verbose: **time-locked** unlock |
| Time-lock clock | **First-interaction timer** — countdown begins on the FIRST of: open basic hint / open target card / submit any flag attempt. Persists across sessions. |
| Pattern C plants | **Same rule as Pattern A/B** — basic = category, verbose = lens+category. Recon-class plants accept that the category-only basic hint may feel terse. |
| Killer chain hints | **Per-step hints inside the chain.** Each step gets its own two-tier hint with chain-context wrapping. |
| Scoring interaction | **Logged-only.** Hint usage recorded in DB; score unaffected; equal points across the scoreboard. Instructor sees hint analytics. |
| Control | **Per-cohort default + per-trainee opt-out.** Instructor sets cohort baseline; trainee can override; override is logged. |
| Default for new cohorts | **OFF.** Hints disabled by default. Cohort creator must explicitly enable. Frames BVBE as CTF first, training material second. |

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  Phase 11 surface (CTF + hints)                              │
│                                                              │
│  Trainee /ctf page                                           │
│   ├─ score: X/44 + Y/4 chains  (flags only — hints don't     │
│   │                              touch score)                │
│   ├─ targets grid                                            │
│   │   ├─ flag submission UI       ┐                          │
│   │   ├─ basic hint button        │ both surfaces share      │
│   │   ├─ verbose hint button      │ the per-target           │
│   │   ├─ verbose unlock countdown │ first-interaction        │
│   │   └─ "your override" toggle   ┘ timer                    │
│   └─ recent submissions log                                  │
│                                                              │
│  Instructor /admin/ctf                                       │
│   ├─ cohort list (with hint default per cohort)              │
│   ├─ cohort scoreboard (flag-only score)                     │
│   ├─ hint-usage analytics (per-trainee per-target reveals)   │
│   ├─ CSV export                                              │
│   ├─ reveal-flag override (single-target per-trainee)        │
│   └─ reset cohort (clears submissions + reveals; keeps audit)│
│                                                              │
│  Storage                                                     │
│   ├─ Cohort      (id, name, salt-fingerprint, hintsDefault,  │
│   │              verboseUnlockSeconds, createdAt)            │
│   ├─ User.cohortId + User.hintsOverride enum                 │
│   ├─ CtfSubmission(cohortId, userId, vulnId|chainId,         │
│   │              valid, submittedAt)                         │
│   └─ CtfHintReveal(cohortId, userId, targetKey, tier,        │
│                  revealedAt)                                 │
│                                                              │
│  Authoring                                                   │
│   └─ docs/hints/                                             │
│       ├─ V-001.md, V-004.md, … V-051.md  (40 files)          │
│       ├─ CHAIN-A.md, CHAIN-B.md, CHAIN-C.md, CHAIN-D.md      │
│       │   (chain-step hints; each step keyed inside the file)│
│       └─ README.md  (authoring guide + tier definitions)     │
│                                                              │
│  Server helpers                                              │
│   ├─ lib/ctf/emit.ts        — flag emission (slice 1+2)      │
│   ├─ lib/ctf/claim.ts       — proof validator registry       │
│   ├─ lib/ctf/derive.ts      — Pattern C deriver              │
│   ├─ lib/ctf/hints.ts       — load + serve hint markdown     │
│   ├─ lib/ctf/interaction.ts — first-interaction recorder     │
│   └─ lib/ctf/cohort.ts      — resolve effective hints policy │
│                              for (user, target)              │
└──────────────────────────────────────────────────────────────┘
```

## Critical files and patterns to extend

### Existing
- `apps/web/lib/ctf.ts:4` — `flagFor(vulnId)`. Reuse verbatim.
- `apps/web/lib/ctf.ts:13` — `ctfModeEnabled()` env-flag check.
  Pattern to copy for `hintsEnabledFor(user)`.
- `apps/web/lib/env.ts:14` — `CTF_MODE` env flag. Add a parallel
  `HINTS_ENGINE_ENABLED` env flag (default `true`) so the whole
  hint subsystem can be disabled at deploy time independently of
  CTF_MODE.
- `scripts/derive-flags.ts:7` — V-NNN list. Refresh to 40 + 4
  chains (already in phase-11 slice 2).
- `packages/db/prisma/schema.prisma` — extend with three new
  models and a `User.cohortId` foreign key.

### New
- `apps/web/lib/ctf/{emit,claim,derive,hints,interaction,cohort}.ts`
- `apps/web/app/api/v2/ctf/{claim,submit,me,hints,interaction}/route.ts`
- `apps/web/app/ctf/page.tsx` — trainee surface.
- `apps/web/app/admin/ctf/page.tsx` — instructor surface.
- `docs/hints/V-*.md` (40 files), `docs/hints/CHAIN-*.md` (4 files),
  `docs/hints/README.md` (authoring guide).
- `packages/db/prisma/migrations/2026….._phase_11_ctf/migration.sql`
  — single migration adding Cohort, CtfSubmission, CtfHintReveal,
  User columns.

## Data model

```prisma
model Cohort {
  id                    String   @id @default(cuid())
  name                  String   @unique
  saltFingerprint       String   // first 16 hex of sha256(CTF_SALT). Lets the
                                 // server reject submissions from a stale
                                 // CTF_SALT without exposing the salt itself.
  hintsDefault          Boolean  @default(false)  // OFF by default per Q4
  verboseUnlockSeconds  Int      @default(900)    // 15 min default. Per-cohort tunable.
  startedAt             DateTime @default(now())
  archivedAt            DateTime?
  members               User[]
  submissions           CtfSubmission[]
  hintReveals           CtfHintReveal[]
  interactions          CtfInteraction[]
}

enum HintsOverride { follow enable disable }

model User {
  // … existing fields unchanged …
  cohortId       String?
  cohort         Cohort?         @relation(fields: [cohortId], references: [id])
  hintsOverride  HintsOverride   @default(follow)
}

model CtfSubmission {
  id           String   @id @default(cuid())
  cohortId     String
  userId       String
  targetKey    String   // "V-22" or "CHAIN-A"
  flagPrefix   String   // first 8 hex of submitted flag — fast-reject; never the full flag.
  valid        Boolean
  submittedAt  DateTime @default(now())

  cohort       Cohort   @relation(fields: [cohortId], references: [id])
  user         User     @relation(fields: [userId], references: [id])

  @@unique([cohortId, userId, targetKey, valid])  // can only score once per target
  @@index([cohortId, submittedAt])
}

model CtfInteraction {
  // First-interaction timer source of truth (locked Q5: "first-interaction timer")
  id              String   @id @default(cuid())
  cohortId        String
  userId          String
  targetKey       String        // V-NNN or CHAIN-X-STEP-N
  firstAt         DateTime @default(now())  // never updated after creation

  cohort          Cohort   @relation(fields: [cohortId], references: [id])
  user            User     @relation(fields: [userId], references: [id])

  @@unique([cohortId, userId, targetKey])
}

model CtfHintReveal {
  // Logged-only — does NOT affect scoring. Locked Q3.
  id           String   @id @default(cuid())
  cohortId     String
  userId       String
  targetKey    String
  tier         Int      // 1 = basic, 2 = verbose
  revealedAt   DateTime @default(now())

  cohort       Cohort   @relation(fields: [cohortId], references: [id])
  user         User     @relation(fields: [userId], references: [id])

  @@unique([cohortId, userId, targetKey, tier])
  @@index([cohortId])
}
```

## Hint authoring

Each `docs/hints/V-NNN.md` follows the strict template:

```markdown
---
target: V-22
category: OWASP / Mass assignment
tier-1-basic: |
  This is a mass-assignment class issue. Find a place that
  spreads user input into a database write.
tier-2-verbose: |
  Server Actions deserialize FormData and forward it to Prisma
  updates. Look for a `for (const [k,v] of formData.entries())`
  pattern. The action belongs to an account-area form.
---
```

Rules baked into a `lib/ctf/hints.ts` parser that loads on boot:

- `tier-1-basic` MUST be ≤ 200 chars and MUST NOT name file
  paths, function names, or CVE numbers (validator: rejects any
  hint whose text matches `apps/`, `packages/`, `CVE-`,
  `__proto__`, etc.).
- `tier-2-verbose` MUST be ≤ 600 chars and MUST NOT include
  literal payloads, exact line numbers, OR reproduction steps
  (validator: rejects `curl `, `POST `, line-number patterns).
  These are LENS + CATEGORY, not LOCATION.
- The validator runs in `lib/ctf/hints.test.ts` and CI; broken
  hints fail the build, not the runtime.

Chain hint file `docs/hints/CHAIN-A.md` has the same template but
with multiple steps keyed by step number:

```markdown
---
target: CHAIN-A
category: Crypto / Trust boundary chain
steps:
  1:
    tier-1-basic: "Step 1: recon. Look for committed credentials."
    tier-2-verbose: "Operational files (.env-shaped backups) sometimes survive in git history even after a delete. The credential you find should match a runtime environment value."
  2:
    tier-1-basic: "Step 2: trust boundary. There's a middleware path that bypasses authentication under certain conditions."
    tier-2-verbose: "Internal-traffic markers are sometimes honored without a JWT. Check what the strip list does and doesn't strip at the gateway."
  3:
    tier-1-basic: "Step 3: protocol-level mismatch in the asset broadcast layer."
    tier-2-verbose: "When a hot wallet broadcasts a transaction the validation step and the broadcast step may not be looking at the same payload. The discrepancy is in how multi-segment envelopes are parsed."
---
```

The chain-step `targetKey` is `CHAIN-A-STEP-1`, `CHAIN-A-STEP-2`,
etc. for the interaction + reveal tables.

## Server helpers

### `lib/ctf/cohort.ts`

```ts
// Resolve the effective hint policy for a (user, target).
// All callers in the hint subsystem go through this.
export async function hintsAllowedFor(
  user: UserClaims,
  targetKey: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!env().HINTS_ENGINE_ENABLED) return { allowed: false, reason: "engine-disabled" };
  if (user.cohortId == null) return { allowed: false, reason: "no-cohort" };
  const cohort = await loadCohort(user.cohortId);
  if (cohort.archivedAt) return { allowed: false, reason: "cohort-archived" };
  const userOverride = await loadUserOverride(user.sub);
  const effective =
    userOverride === "enable" ? true :
    userOverride === "disable" ? false :
    cohort.hintsDefault;
  return { allowed: effective };
}
```

### `lib/ctf/interaction.ts`

```ts
// Record the first interaction for a (user, target). Idempotent.
// Returns the firstAt timestamp, creating the row if needed.
export async function recordFirstInteraction(
  cohortId: string, userId: string, targetKey: string,
): Promise<Date> {
  const existing = await db.ctfInteraction.findUnique({
    where: { cohortId_userId_targetKey: { cohortId, userId, targetKey } },
  });
  if (existing) return existing.firstAt;
  const row = await db.ctfInteraction.create({
    data: { cohortId, userId, targetKey },
  });
  return row.firstAt;
}

// Verbose unlock check
export async function verboseUnlockedFor(
  cohortId: string, userId: string, targetKey: string, now: Date = new Date(),
): Promise<{ unlocked: boolean; secondsRemaining: number }> {
  const cohort = await loadCohort(cohortId);
  const inter = await db.ctfInteraction.findUnique({
    where: { cohortId_userId_targetKey: { cohortId, userId, targetKey } },
  });
  if (!inter) return { unlocked: false, secondsRemaining: cohort.verboseUnlockSeconds };
  const elapsed = (now.getTime() - inter.firstAt.getTime()) / 1000;
  if (elapsed >= cohort.verboseUnlockSeconds) return { unlocked: true, secondsRemaining: 0 };
  return { unlocked: false, secondsRemaining: Math.ceil(cohort.verboseUnlockSeconds - elapsed) };
}
```

### `lib/ctf/hints.ts`

- Loads `docs/hints/*.md` at module-load time (server-only).
- Validates each file's frontmatter against the depth-ceiling
  rules described above.
- Exposes `loadHint(targetKey, tier)` returning prose or throwing
  if invalid target / not loaded.

### Routes (Slice 3 additions)

- `POST /api/v2/ctf/interaction` — body `{ targetKey }`. Calls
  `recordFirstInteraction`. Fires when trainee opens a target
  card OR opens basic hint OR submits a flag. Idempotent. Returns
  `{ firstAt, verboseAt }`.
- `GET /api/v2/ctf/hints/:targetKey?tier=basic|verbose` —
  - Calls `hintsAllowedFor` → 403 if disabled.
  - For tier=verbose: calls `verboseUnlockedFor` → 425 (Too
    Early) with countdown if not yet unlocked.
  - Writes a `CtfHintReveal` row (idempotent on the unique
    constraint).
  - Returns the prose.
- `PATCH /api/v2/ctf/me/hints-override` — body `{ override:
  "follow" | "enable" | "disable" }`. Updates `User.hintsOverride`.
  Audit-logged. Available regardless of cohort default.
- `GET /api/v2/ctf/me` — returns:
  - cohort summary (name, hintsDefault, verboseUnlockSeconds)
  - trainee's `hintsOverride` + effective policy
  - per-target status: submitted/valid, firstAt, verboseUnlocksAt,
    basic-revealed-at, verbose-revealed-at.

## /ctf page (trainee surface)

Layout (no UI assumed — drafted from scratch):

```
┌─ /ctf ──────────────────────────────────────────────────────┐
│  COHORT: Spring 2026 / B    Score: 12/44 flags + 1/4 chains │
│  Salt fp: 4f8a…             Hints: cohort=OFF  you=enabled  │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [ Paste a BVBE{…} flag                ] [ Submit ]         │
│                                                             │
│  PLANT TARGETS (40)                                         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │ V-01       │ │ V-04       │ │ V-06       │  …            │
│  │ ✓ found    │ │ ⌛ open    │ │ — unsubmit│               │
│  │ Hint ▸     │ │ Hint ▸     │ │ Hint ▸     │               │
│  └────────────┘ └────────────┘ └────────────┘               │
│                                                             │
│  KILLER CHAINS (4)                                          │
│  CHAIN A — Drain hot wallet [step 2/5]                      │
│   ├─ Step 1 ✓     Hint ▸                                    │
│   ├─ Step 2 ⌛    Hint ▸  Verbose unlocks in 09:12          │
│   └─ Step 3+ locked                                         │
│  …                                                          │
│                                                             │
│  Settings ▾                                                 │
│   Override cohort hints policy:                             │
│   ◯ Follow cohort default (currently OFF)                   │
│   ◯ Enable hints for me                                     │
│   ◯ Disable hints for me                                    │
└─────────────────────────────────────────────────────────────┘
```

Card states per target:
- `unseen` — no interaction recorded yet
- `engaged` — interaction recorded; verbose countdown running
- `verbose-unlocked` — verbose hint available
- `basic-revealed`, `verbose-revealed` — reveal events logged
- `submitted-invalid` — has wrong submissions
- `valid` — has the flag

Hint button states (when `hintsAllowedFor` returns `allowed`):
- "Show basic hint" → expands inline panel, fires
  `POST /api/v2/ctf/hints/V-22?tier=basic`.
- "Verbose unlocks in MM:SS" → disabled countdown.
- "Show verbose hint" → expands, fires tier=verbose.

When `hintsAllowedFor` returns `allowed: false`: no hint button
at all. The card shows only flag submission UI.

## /admin/ctf page (instructor surface)

Two tabs:

**Cohorts:**
- List rows: name, status, member count, score-leader, hints
  default, verbose-unlock seconds, # overrides.
- Per-row actions: archive, reset (drops Submissions +
  HintReveals + Interactions; keeps cohort itself).
- "Edit cohort" panel: change hintsDefault, change
  verboseUnlockSeconds, change name. Audit-logged.

**Hint analytics (per cohort):**
- Scoreboard (flag-only score; ranks by `valid=true` count).
- Side-by-side: hint-usage column showing
  `basic-reveals / verbose-reveals` per trainee. NOT ranked
  on; instructor reads to spot patterns (e.g., trainee A
  scored 18/44 with 0 hints; trainee B scored 22/44 with 30
  reveals — different exercises).
- Per-target heat map: "V-22 was revealed by 17/30 trainees"
  to spot too-hard plants for the next cohort.
- CSV export of submissions + reveals.
- Reveal-flag override: per-trainee per-target unlock for a
  single stuck trainee. Audit-logged.

## Slice plan (revised to fold hints in)

The phase-11 plan already has 4 slices. This spec extends them
without adding new slices:

### Slice 1 — Emission core (unchanged from original plan)
Existing scope. No hint code. Lands the flag-emission seams,
8 reference V-NNN wirings, byte-diff QA for CTF_MODE off.

### Slice 2 — Fan-out (unchanged from original plan)
Existing scope. All 40 V-NNN + 4 chain detectors. Refresh
`scripts/derive-flags.ts`. No hint code.

### Slice 3 — /ctf page + hints engine (extended)
Original scope:
- `/ctf` trainee page, `CtfSubmission` model, submit API.

Hint additions:
- Models: `Cohort`, `User.cohortId`, `User.hintsOverride`,
  `CtfInteraction`, `CtfHintReveal`.
- Helpers: `lib/ctf/{cohort, interaction, hints}.ts` + tests.
- Routes: `/api/v2/ctf/{interaction, hints, me, me/hints-override}`.
- Hint authoring: all 40 `docs/hints/V-*.md` + 4
  `docs/hints/CHAIN-*.md`. Validator runs in CI.
- UI: target cards gain hint button + verbose countdown +
  settings panel for opt-out.
- Tests: hint depth-ceiling validator (rejects bad markdown),
  first-interaction idempotency, verbose unlock arithmetic,
  `hintsAllowedFor` resolution matrix (cohort default × user
  override).

### Slice 4 — /admin/ctf + cohort tooling (extended)
Original scope:
- `/admin/ctf` page, cohort list, scoreboard, CSV export,
  reveal-flag override, `scripts/new-cohort.sh`.

Hint additions:
- Edit-cohort UI: hintsDefault, verboseUnlockSeconds.
- Hint-usage analytics panel.
- Per-target heat map.
- Reset cohort wipes `CtfHintReveal` + `CtfInteraction` rows
  along with submissions.
- README docs the per-cohort hint workflow.

## Hard rules preserved

- `CTF_MODE=false` default unchanged.
- `HINTS_ENGINE_ENABLED=true` default (but does nothing unless
  a cohort exists with hints enabled OR a user overrode).
- Default new-cohort hints state: **OFF**.
- All hint code paths short-circuit when `hintsAllowedFor`
  returns `allowed: false`. Performance cost when disabled:
  one env-flag check + one in-memory cohort lookup. No DB
  writes when disabled.
- Hint depth ceiling enforced by validator; broken hints fail
  CI not runtime.
- Hint usage is **logged-only**: zero effect on
  `CtfSubmission.valid` or the scoreboard's flag count.
- Zero new V-NNN. The hint markdown is instructor-authored;
  no exploit logic changes.

## Verification

End-to-end test recipe for slice 3:

1. **DB setup.** `pnpm db:migrate dev` applies the phase-11
   migration. Schema has `Cohort`, `CtfSubmission`,
   `CtfInteraction`, `CtfHintReveal`. `User.cohortId` +
   `hintsOverride` columns added.

2. **Cohort creation.** Run `scripts/new-cohort.sh test-cohort
   --hints=off`. Verify a Cohort row exists with `hintsDefault
   = false`.

3. **Hints disabled flow.** Log in as a trainee in test-cohort.
   `GET /ctf` shows no hint button anywhere. `GET
   /api/v2/ctf/hints/V-22?tier=basic` returns 403 with reason
   `cohort-default-disabled`.

4. **Trainee opt-in.** `PATCH /api/v2/ctf/me/hints-override`
   with `{ override: "enable" }`. `User.hintsOverride` now
   `enable`. `/ctf` now shows hint buttons.

5. **Basic hint reveal.** Click "Show basic hint" on V-22.
   `CtfInteraction` row created with firstAt = now. Response
   prose matches `docs/hints/V-22.md` tier-1-basic. A
   `CtfHintReveal(tier=1)` row exists.

6. **Verbose not yet unlocked.** Click "Show verbose hint"
   within 15 min. 425 Too Early; response includes
   `secondsRemaining`. No reveal row written.

7. **Verbose unlocks.** Set cohort.verboseUnlockSeconds=1 via
   admin UI; wait 2s; verbose reveal succeeds. Reveal row
   written with `tier=2`. Prose matches `tier-2-verbose`.

8. **Idempotency.** Reveal verbose twice. Second call returns
   the prose; only ONE `CtfHintReveal(tier=2)` row exists.

9. **Score unaffected.** Submit the valid V-22 flag. Score
   increments by 1. Hint reveals visible on instructor side.
   Trainee-visible score is identical to a trainee who got V-22
   without hints.

10. **Chain step hints.** Open `CHAIN-A-STEP-1` card. Basic hint
    reveals. Submit the V-48 flag (CHAIN-A's first step).
    `CtfSubmission(targetKey="V-48")` lands. Open
    `CHAIN-A-STEP-2` basic hint. Different prose. Verbose
    countdown ticks independently per step.

11. **Validator.** Edit one `docs/hints/V-22.md` to include
    `apps/web/app/account/orders/edit-order.ts`. `pnpm -w run
    test` fails with depth-ceiling violation. Revert; tests
    pass.

12. **CTF_MODE=false byte-diff.** Hit 10 representative endpoints
    twice — once with CTF_MODE=true + hints enabled, once with
    CTF_MODE=false + hints engine disabled — and assert response
    bodies are byte-identical when no exploit fires. Carries
    forward the slice-1 paranoid-QA check.

13. **VULNS.md untouched.** `git diff HEAD~5 -- VULNS.md` is
    empty. All 40 V-NNN plant constructs intact at HEAD
    (re-spot-check via grep at cited offsets).

End-to-end test recipe for slice 4:

1. **Two cohorts, isolated salts.** `scripts/new-cohort.sh
   cohort-A` + `scripts/new-cohort.sh cohort-B` with rotated
   `CTF_SALT`. Flag from A's table does not validate against
   B's salt fingerprint.

2. **Per-cohort hint default.** Admin flips cohort-A
   hintsDefault on; cohort-B remains off. Trainees see different
   experiences.

3. **Reveal-flag override.** Instructor reveals V-33 for a
   single trainee in cohort-A. Trainee's `CtfSubmission` for
   V-33 has `valid=true` and `revealedByAdmin=true` audit
   marker. Other trainees unaffected.

4. **Reset cohort.** Reset cohort-B. All `CtfSubmission`,
   `CtfInteraction`, `CtfHintReveal` rows for cohort-B drop.
   `admin_audit_logs` retains the reset event. Cohort-A
   untouched.

5. **CSV export.** Download cohort-A scoreboard + hint
   analytics. Format: one row per (trainee, target) with
   valid/invalid, basic-revealed, verbose-revealed, timestamps.
