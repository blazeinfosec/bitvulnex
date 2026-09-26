# Bitvulnex Discovery Progression — suggested cohort curriculum

> A two-day curriculum for a typical mid-to-senior pentest cohort,
> calibrated to the post-Phase-9 ship state of the lab. Adjust pacing
> based on cohort experience; the structure is the load-bearing part.

## Cohort target

The default plan assumes 6-12 trainees with 2+ years of web pentest
experience, working in pairs, with one lead instructor and ideally
one co-instructor. Trainees have a Linux/macOS terminal, `curl`,
`python3`, `jq`, `git`, and a working Burp Suite (or equivalent).

A cohort of less-experienced trainees can complete Day 1 in the
allotted time but typically reaches only CHAIN C by end of Day 2.
A cohort of senior trainees can compress Day 1's plant warm-ups
into the morning and run all four chains across Day 1 afternoon +
Day 2.

## Day 1 — surface discovery and standalone plants

### Morning (3 hrs) — warm-up plants, build confidence

**Goal.** Trainees find 4-6 easy-tier plants. Builds momentum and
gives the instructor a read on cohort depth.

The four canonical Day-1-morning targets:

1. **V-13 — login `?next=` open redirect.** Browser-based. Most
   trainees find this within 20 minutes. Establishes that "the
   front-end is in scope."
2. **V-8 — JWT alg=none.** Source skim of `jwt-v1.ts` reveals the
   `if (alg === "none")` branch. Trainees who haven't worked with
   JWT internals before benefit from the hint "look at every
   branch the verifier supports." 30-45 minutes typical.
3. **V-14 — KYC path traversal.** `?file=` query parameter
   suggestion. Trainees probe `../../../etc/passwd` and similar.
   15-30 minutes typical.
4. **V-1 — displayName stored XSS.** Trainees set a malicious
   displayName, then check whether admin page reflects it. This
   requires standing up an admin session (or the instructor
   demonstrates the admin-side fire with a forged JWT later).

**Optional fifth (cohort-depth-dependent):**

5. **V-4 — IDOR on order GET/DELETE.** A trainee with API-probing
   instincts will hit this within an hour. Sequential IDs make it
   easy.

**Hint progression (if a trainee is stuck for 30+ minutes):**

| Plant | First hint | Second hint | Spoiler hint |
|-------|-----------|-------------|--------------|
| V-13 | "What happens to `?next=` after login?" | "Try a `//attacker` value." | "The router pushes the value verbatim." |
| V-8 | "Read `packages/shared/src/jwt-v1.ts`. What algorithms does it support?" | "What does the `alg === 'none'` branch do?" | "It returns the payload without checking the signature." |
| V-14 | "Probe `/api/v2/me/kyc/doc` with different `file=` values." | "What does the handler do with `file`? `join(UPLOADS_DIR, file)`." | "Traversal works: `?file=../../package.json`." |
| V-1 | "Set displayName to `<img src=x>`. Does it render in the admin page?" | "Look at `apps/web/app/admin/users/page.tsx`." | "`dangerouslySetInnerHTML` on `nameCell(u)`." |
| V-4 | "What does `/api/v2/me/orders/<id>` return for other users' orders?" | "Is there a `userId` filter on the Prisma query?" | "There isn't — the handler trusts the URL." |

### Afternoon (3.5 hrs) — medium plants, chain pre-staging

**Goal.** Trainees find 3-4 medium-tier plants and produce 1-2
working PoCs that combine plants.

**Target plants:**

- **V-11 — SQLi via `?perf=1`.** Requires admin token (forged via
  V-48 if trainees have found that first, or seeded via instructor
  hand-out). Demonstrates UNION-based password-hash exfil.
- **V-25 — self-trade.** Pure source observation; demo by placing
  matched orders on the same user. Sets up CHAIN C.
- **V-40 — KYC SSRF.** Tier-1 user probes `import-url`. Demos
  hitting `169.254.169.254`. Sets up CHAIN D Path 2.
- **V-19 — JWT key confusion.** Trainees fetch JWKS, recognize the
  algorithm confusion shape, forge an HS256 token with the RSA
  public key as the HMAC secret.

**Optional chain pre-stage:** introduce V-48 (git-history JWT
secret) at the end of the afternoon. Many trainees will combine
V-48 + V-6 → admin reach on their own; this sets up Day 2's
chains.

**Hint progression:**

| Plant | First hint | Second hint | Spoiler hint |
|-------|-----------|-------------|--------------|
| V-11 | "There's a `perf` flag on the admin search. What does it do?" | "Check `route.ts` — does the `perf===1` branch use parameterized queries?" | "`$queryRawUnsafe` with interpolation. UNION-inject." |
| V-25 | "Place two orders on the same user — does the engine match them?" | "It does. Now look at the price feed." | "Self-trades write Trade rows. Public oracle reports the last." |
| V-40 | "What does `import-url` do with the URL?" | "What does the `isLocalHost` allowlist check?" | "Only `localhost / 127.0.0.1 / ::1`. Try `169.254.169.254`." |
| V-19 | "JWKS is at `/.well-known/jwks.json`. What does the v1 verifier do when alg=HS256 + kid=legacy-2022?" | "It loads the file `apps/web/keys/legacy-2022`." | "...and uses its bytes as the HMAC secret." |

By end of Day 1, trainees should have 8-10 findings and at least
one working forged-JWT-admin token.

## Day 2 — chains and hard plants

### Morning (3.5 hrs) — CHAIN C end-to-end + hard standalone plants

**Goal.** Complete CHAIN C (the most accessible chain) and demo at
least one hard-tier standalone plant.

**CHAIN C tutorial (1.5 hrs).** Walk the cohort through CHAIN C
end-to-end. The chain is mechanically simple but pedagogically
rich — demonstrates how a single primitive (V-25 self-trade) cascades
through cached oracle → liquidation worker → keeper rebate. See
`02-killer-chains.md` §CHAIN C for the step-by-step.

**Hard plants (2 hrs).** Pick two or three depending on cohort
depth:

- **V-32 — OCO cancel race.** Tied to V-28 and V-45 as a "race
  condition family." Demonstrate one, ask trainees to find the
  others.
- **V-44 — lending yield front-run.** DeFi-protocol audit pattern;
  good talking point even if the trainee doesn't construct a live
  PoC.
- **V-12 — second-order SQLi.** Pairs with V-1's stored-XSS pattern
  — "stored input is dangerous *somewhere*."
- **V-34 — proto pollution.** Demonstrates two niceties: (a) the
  zod 3 top-level strip behavior, (b) the `for...in` over
  prototype-backed defaults gadget.

**Hint progression for hard plants:**

| Plant | First hint | Second hint | Spoiler hint |
|-------|-----------|-------------|--------------|
| V-32 | "Place an OCO pair; trigger the stop; rapid-cancel the take-profit." | "What's the Prisma transaction isolation level?" | "READ COMMITTED, no `SELECT FOR UPDATE`. HTTP/2 multiplex." |
| V-44 | "Read `apps/worker/src/yield-accrual.ts`. When does the worker read the supply set vs. compute interest?" | "Supply set is read *after* interest is computed." | "Front-run the tick: supply just before, harvest just after." |
| V-12 | "Set displayName to a SQLi payload. Does anything happen?" | "What admin job reads displayName via raw SQL?" | "Compliance report — `$queryRawUnsafe` per case." |
| V-34 | "POST to `/api/v1/internal/trade-debug/replay` with `{config:{__proto__:{...}}}`. Does it pollute?" | "zod 3 strips top-level `__proto__`. Try nested." | "`{config:{a:{__proto__:{...}}}}` survives zod and reaches deepMerge." |

### Afternoon (3.5 hrs) — killer chains A, B, and D

**Goal.** Run all three remaining chains end-to-end. Senior
cohorts can attempt all three; mid-tier cohorts should pick the
two that map best to their interest area.

**Recommended ordering by cohort interest:**

- **Web-pentest-heavy cohort:** CHAIN D Path 2 (SSRF → IMDS →
  S3) first (1.5 hrs), then CHAIN B (CL/TE smuggle) (2 hrs).
- **Bitcoin/protocol-heavy cohort:** CHAIN A (drain hot wallet)
  first (2 hrs), then CHAIN D Path 1 as a 30-min victory lap,
  then CHAIN B time-permitting.
- **Balanced cohort:** all three, 1 hour each, accept that the
  smuggle may not land cleanly for everyone in the time budget.

**CHAIN A pacing:**
1. V-48 recon (15 min — most cohorts have found this on Day 1).
2. Forge admin JWT (15 min).
3. V-6 bypass to internal namespace (5 min — one header).
4. Create + sign a treasury draft (20 min — most complex step
   procedurally).
5. Construct polyglot PSBT (30 min).
6. Broadcast and observe (10 min).

**CHAIN B pacing:**
1. Confirm V-50 both halves (10 min).
2. Standalone V-51 PoC against own JWT (15 min — confidence-
   builder).
3. Raw-TCP smuggle construction (45 min — the hard part).
4. Land the smuggle on a pipelined victim connection (30 min —
   often requires instructor demo).
5. Persistence — second admin row (5 min).

**CHAIN D Path 2 pacing:**
1. Reach Tier-1 (10 min).
2. V-40 SSRF to IMDS role list (15 min).
3. SSRF to IMDS credentials endpoint (10 min).
4. Read stored doc body, extract creds (15 min).
5. Pivot to mock-s3 listing (15 min).
6. Fetch synthetic KYC documents (15 min).

> **INSTRUCTOR NOTE:** The smuggle *does* reproduce end-to-end on the
> shipped `nginx:1.18-alpine` edge (dev-mode: warm the outer and
> smuggled routes once so they're compiled before the raw-TCP send).
> The realisation that *both* the nginx half and the Node half are
> needed is the teaching moment; constructing a clean sender is a
> tooling problem more than a security insight. Award full credit for a
> landed smuggle, and partial credit for "trainee identified both
> halves and articulated the mechanism" if their socket script doesn't
> fire cleanly in the time budget.

## Stretch goals (optional, post-Day-2)

For trainees who clear all four chains and want more:

- **V-49 (dependency confusion)** as a discussion exercise. Walk
  through Birsan 2021, the `optionalDependencies` declaration, and
  the missing `.npmrc`. Do NOT publish anything to public npm —
  the PoC is documentation-only.
- **V-46 (OTC desk header)** as a quick standalone find. Pair
  with V-6 — "audit which client-controllable headers the backend
  trusts."
- **V-21 (refresh token not single-use)** as a Day-3 deep-dive.
  Pair with V-1 as the realistic theft vector.

## Calibration checks during the cohort

After each session, the lead instructor should pulse-check:

- **End of Day 1 morning:** are trainees getting 4+ easy plants
  each? If not, shift afternoon scope down (drop the harder
  medium plants).
- **End of Day 1 afternoon:** has at least one trainee found
  V-48 + V-6 → admin reach? If not, hand it out as the Day 2
  morning warm-up.
- **End of Day 2 morning:** is CHAIN C demonstrated by every
  team? If not, run a group walkthrough before splitting into
  chain pairs.

## Scoring rubric (suggested)

If the cohort is competitive / CTF-style, use this rubric:

| Discovery difficulty | Standalone find | Working PoC |
|----------------------|-----------------|-------------|
| Easy | 1 pt | +1 pt |
| Medium | 2 pts | +1 pt |
| Hard | 3 pts | +2 pts |
| Expert (V-33 only) | 5 pts | +3 pts |

| Chain | Completion bonus |
|-------|------------------|
| A — drain hot wallet | +10 pts |
| B — admin persistence | +8 pts |
| C — mass liquidation | +5 pts |
| D — DB+KYC (Path 2) | +6 pts |
| D — DB+KYC (Path 1) | +2 pts |

Max achievable score for a cohort that finds every plant and
walks every chain: ~120 points. Anything over 80 is a strong
cohort showing.

## Materials to prepare ahead of the cohort

- Pre-staged user accounts (one Tier-0, one Tier-1, one Tier-3)
  with realistic balances. The seed framework
  (`scripts/seed-framework.ts`) covers this — re-run
  `pnpm seed` if the lab has been reset.
- A pre-baked margin position book so CHAIN C has victims to
  liquidate. Add a "victim wallet" seed scenario if not already
  present.
- A reference `forge.py` and `smuggle.py` on each cohort machine
  (see `02-killer-chains.md`). Trainees can reference but should
  not get the running version handed to them.
- The instructor's own copy of `VULNS.md` and the four
  `04-exploitability-audit.md` caveats. Do NOT share with
  trainees.

## After the cohort

The lab is designed to support a "patch and re-attack" blue-team
exercise as a follow-on. Each V-NNN has a `Remediation:` field in
`VULNS.md`. A typical follow-on day: blue team applies one chain's
remediations, red team re-verifies the chain closes, both teams
debrief on the test coverage that would have caught the original
plant.

Useful debrief talking points:

- **V-28 and V-45 share a race-condition shape.** Why is it
  natural for engineers to write this pattern? What test would
  have caught it?
- **V-22 mass-assigns Order; V-51 mass-assigns User.** Same
  bug class, different blast radius. What does the difference
  teach about column-level allowlists?
- **V-25 + nginx cache + liquidation worker = oracle
  manipulation.** No single component is "wrong" — the
  composition is. What's the test architecture that would catch
  emergent failures across service boundaries?
- **CHAIN A combines an ops mistake (V-48) with a header trust
  pattern (V-6) with an obscure parser quirk (V-33).** None of
  the three is uniquely "the bug." What does this say about
  defense in depth?
