# Phase 11 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-05-29
> **Verdict:** **Approved with conditions** (5 conditions, all
> mechanical — no scope changes).

## Scope assessment

Phase 11 is the **product completion phase**. Every prior phase
asked "how do we plant realistic vulns?" Phase 11 asks "how does
the trainee *know* they found one?" Without it, the lab is a
beautiful demo that can't be used unattended — which is precisely
when CTFs and self-paced training matter most.

The plan correctly identifies the gap (zero call sites for
`flagFor` / `ctfModeEnabled` despite the scaffolding existing
since Phase 0) and proposes a three-pattern delivery model
(inline / side-channel / self-derivable) plus chain-completion
flags. Pattern selection per V-NNN looks defensible — see
§"Per-vuln pattern review" below for the architect's signoff on
each pick.

The 4-slice sequence is correct. Slice 1 deliberately wires only
8 V-NNNs end-to-end before fanning out — this is the right
discipline; the seams need to prove out before slice 2's 32×
multiplication. Slices 3 and 4 are pure UI/admin work and could
in principle run concurrently, but the plan keeps them
sequential, which the architect blesses (lower coordination cost,
each slice ships clean).

**Approved scope. Approved sequencing. Approved 4-slice budget
(~5-7 days).**

## Vuln allocation review — zero new V-NNN

The plan explicitly commits to "Zero new V-NNN." The architect
walked the four new code paths the plan introduces and confirms:

1. **`apps/web/lib/ctf/emit.ts`** — pure additive. First line is
   `if (!ctfModeEnabled()) return payload;`. No mutation of
   existing handlers; the helper is *called* from handlers but
   the existing logic flow is unchanged.

2. **`apps/web/app/api/v2/ctf/*` routes** — new namespace. No
   pre-existing handlers touched. The `claim` and `submit` routes
   are auth-gated and rate-limited (per the plan's R-3
   mitigation).

3. **`apps/web/app/ctf/page.tsx`** — pure frontend, reads only
   ctf-prefixed endpoints.

4. **`apps/web/app/admin/ctf/page.tsx`** — admin-gated, additive
   to existing admin layout.

5. **DB: `CtfSubmission` model** — new table, no migrations on
   existing tables. The `flagHashPrefix` column stores a derived
   hash, not raw salt material. **Architect verifies:** the
   model docstring must call this out explicitly so future
   maintainers don't accidentally store the salt or pre-image.

The risk surface is wire-up, not new plants. Approved.

## Per-vuln pattern review

The architect walked each V-NNN's proposed pattern. Three picks
need adjustment; the rest stand.

| V-NNN | Plan picks | Architect verdict |
|-------|------------|-------------------|
| V-1   | Pattern B  | ✅ Confirmed. The XSS payload's exfil endpoint is the natural detector. |
| V-4   | Pattern A  | ✅ Confirmed. Same condition as the plant. |
| V-6   | Pattern A  | ✅ Confirmed — emit on the bypassed internal route. |
| V-8   | Pattern A  | ✅ Confirmed. Detector: `verifyAccessToken` returns claims on a token whose alg header was "none". |
| V-9   | Pattern C  | ✅ Confirmed. The discovered secret is `changeme`. |
| V-10  | (not listed) | ⚠️ **Condition 1.** V-10 (predictable reset token) is in `VULNS.md` but the plan omits it. Add Pattern B: proof = the predicted reset URL. |
| V-11  | Pattern B  | ✅ Confirmed. |
| V-12  | Pattern B  | ✅ Confirmed. |
| V-13  | Pattern B  | ✅ Confirmed. The off-origin URL with server-issued nonce. |
| V-14  | Pattern B  | ✅ Confirmed. The marker-file contents. |
| V-15  | Pattern C  | ✅ Confirmed. CVE-2023-0842. |
| V-17  | Pattern B  | ✅ Confirmed. |
| V-18  | Pattern B  | ✅ Confirmed. |
| V-19  | Pattern A  | ✅ Confirmed. |
| V-20  | Pattern B  | ✅ Confirmed. |
| V-21  | Pattern A  | ✅ Confirmed. |
| V-22  | Pattern A  | ⚠️ **Condition 2.** Pattern A here means the response includes `_flag` when a non-allowlist field was written. **Risk:** that's an oracle — a trainee can probe field names by toggling the `_flag` presence. **Architect's fix:** Pattern A still, but emit on `GET /api/v2/me` (the *next* request) when `role !== "user"` *and* the audit log shows the role change came from a `PATCH` to `/me` (Server Action wire format). That way the oracle isn't on the PATCH itself; it's on the verification step. |
| V-23  | Pattern A  | ✅ Confirmed. WS message channel. |
| V-24  | Pattern B  | ✅ Confirmed. |
| V-25  | Pattern A  | ✅ Confirmed. Most natural: emit when `maker.userId === taker.userId`. |
| V-26  | Pattern C  | ⚠️ **Condition 3.** V-26's "discovered secret" is the UTC calendar boundary — but that's known to everyone (it's just today's date). That's a degenerate Pattern C (anyone can derive without exploiting). **Architect's fix:** promote V-26 to Pattern A. Emit when a same-day same-asset second withdrawal is accepted past the limit. |
| V-27  | Pattern B  | ✅ Confirmed. |
| V-28  | Pattern B  | ✅ Confirmed. |
| V-30  | Pattern B  | ✅ Confirmed. |
| V-32  | Pattern A  | ✅ Confirmed. Double-refund detection. |
| V-33  | Pattern B  | ✅ Confirmed — bitcoin-mock emits on broadcast where validated ≠ finalized output. |
| V-34  | Pattern B  | ✅ Confirmed. `flags.adminPanel === true` without a `flags` claim. |
| V-35  | Pattern B  | ✅ Confirmed. |
| V-40  | Pattern A  | ✅ Confirmed. Hostname check at fetch time. |
| V-41  | Pattern B  | ✅ Confirmed. Polyglot rendered HTML in admin. |
| V-42  | Pattern A  | ✅ Confirmed. Worker emits in audit row. |
| V-43  | Pattern A  | ✅ Confirmed. |
| V-44  | Pattern A  | ✅ Confirmed. |
| V-45  | Pattern A  | ✅ Confirmed. |
| V-46  | Pattern A  | ✅ Confirmed. |
| V-47  | Pattern A  | ✅ Confirmed. |
| V-48  | Pattern C  | ✅ Confirmed. The leaked secret value. |
| V-49  | Pattern C  | ✅ Confirmed. The private-scope name. |
| V-50  | Pattern A  | ✅ Confirmed. |
| V-51  | Pattern A  | ✅ Confirmed. |

**Net:** 18 Pattern A + 13 Pattern B + 5 Pattern C + V-10 added
(Pattern B) + V-26 promoted (Pattern A) = **40 V-NNN, all
covered.** Plus 4 chain flags.

## Decisions on the plan's open questions

The plan asks for architect to lock 5 decisions. Architect's
picks:

1. **Pattern A vs B for borderline cases (V-22, V-32, V-46).**
   See per-vuln review above. V-22 stays Pattern A but the
   detector moves to the verification step (Condition 2). V-32
   and V-46 stay Pattern A as written.

2. **`CTF_MODE` granularity.** Single global flag. Approved.
   Per-V-NNN opt-in is over-engineering — a cohort either runs
   CTF mode or doesn't.

3. **Chain detector storage.** Plan's split — in-memory Redis
   key (with TTL ≤ 15min) for CHAIN A and D; DB audit-log trail
   for CHAIN B and C. Approved. Add a fall-back when Redis is
   missing: the chain flag silently isn't emitted (no fatal).
   Trainees who hit Redis-unavailable cohorts can still get
   per-V-NNN flags; they lose only the chain bonus.

4. **Scoring config.** Plant = 1, chain = 5. Approved.
   Difficulty multipliers are tempting but introduce subjectivity
   (V-33 expert vs V-4 easy — does V-33 pay 3× because it's
   harder?). Keep it simple; let cohort organizers introduce
   their own multipliers in their CTF platform on top of BVBE's
   scores.

5. **`/ctf` page route.** Top-level `/ctf`. Approved. Trainees
   live on this page during the exercise; it deserves a top-level
   route.

## Conditions for Gate 2 entry

The architect approves slice 1 to enter Gate 2 (staff engineer
implementation) once these five conditions are met:

1. ✅ **V-10 added to slice 2's Pattern B list.** Proof = the
   reset URL containing the predicted hash.

2. ✅ **V-22 detector moves to the verification step**
   (`GET /api/v2/me`), not the PATCH itself, to avoid the
   field-name oracle.

3. ✅ **V-26 promoted from Pattern C to Pattern A.**
   The UTC date is not a secret.

4. ✅ **`CtfSubmission` model docstring** explicitly forbids
   storing `CTF_SALT` or the pre-image. The `flagHashPrefix`
   column is for fast-reject only; full validation always re-runs
   `flagFor(vulnId, env.CTF_SALT)` and compares.

5. ✅ **Slice 1's paranoid-QA must include a byte-diff
   response comparison** — pick 5 representative endpoints, run
   each twice (CTF_MODE=true then =false), assert identical
   response bytes when no exploit fires. This catches R-1
   (emission softening a plant) on the spot.

## Surfaces unchanged

Phase 11 does not touch:

- Any V-NNN's planted construct (verified above).
- Phase 9's `.env.bak` git history.
- Phase 9's `docker-compose.yml`'s `JWT_SECRET=devsecret-...`
  literal or `NODE_OPTIONS: --insecure-http-parser`.
- Phase 9's `nginx/nginx.conf` CL/TE directives or strip list.
- Phase 10's design-system tokens or UX flows.
- The default `CTF_MODE=false` (architect explicitly preserves
  this so the lab continues to behave today's behavior in default
  builds).

## Test discipline

- Every emitter gets a unit test asserting on/off behavior.
- Every chain detector gets an integration test that walks the
  PoC from the corresponding `docs/phases/phase-N/adversarial-qa.md`
  and asserts the flag appears.
- Slice 1 ships with the byte-diff comparison (condition 5).
- Slice 3's `/ctf` page gets a happy-path Playwright/browser test
  using the existing E2E harness from `docs/E2E-TEST-PLAN.md`.

## Gate 2 entry: GO (pending 5 conditions)

Staff engineer may proceed with **slice 1** once the five
conditions above are reflected in the plan (a quick edit to
`plan.md`'s slice 1 and slice 2 deliverables suffices — no
re-review needed).

Slices 2, 3, and 4 enter their own Gate-2 cycles in turn after
the preceding slice closes all four gates and the L7 review
returns PASS.

— Architect
