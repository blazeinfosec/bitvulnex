# Phase 1 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-05-28
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 1 maps cleanly to a real exchange's first feature delivery
(signup → login → 2FA → password reset → API keys). The vertical
slice covers DB + API + UI + tests, satisfying CLAUDE.md's
phase-shipping rule. Seven planted vulns (V-8/9/10/19/20/21/35)
all sit in plausible exchange surfaces — none are contrived.

## Module boundaries

The clean-vs-vulnerable JWT split is correctly maintained: `jwt.ts`
is untouched (Phase 0 file), `jwt-v1.ts` is the new vulnerable
sibling. Routes under `/api/v1/*` import `jwt-v1`; routes under
`/api/v2/*` import `jwt`. An auditor tracing imports will see the
boundary.

The RSA legacy keypair lives in `packages/shared/src/legacy-keys.ts`.
The plan calls it "synthetic" — confirm with Paranoid QA that the
key bytes aren't from any real keypair in the wild (must be
generated specifically for this lab).

## Vuln placement review

Each placement is realistic:

- **V-8 (alg=none):** Lives in a "legacy verifier" file. A careless
  engineer extending a 2022-era verifier to support 2FA might
  plausibly forget to harden the alg whitelist. ✅
- **V-9 (weak default):** A `.default("bvbe-dev-secret-2022")` on
  `JWT_SECRET_LEGACY` looks like a "make dev work without setup"
  shortcut. Pair with V-8 — both surface via v1 mount. ✅
- **V-10 (predictable reset):** `sha256(userId + Date.now())` is a
  textbook "I made it secure-looking but didn't use a CSPRNG" bug.
  Truncating to 16 chars makes Burp Intruder/turbo-intruder
  brute-force tractable. ✅
- **V-19 (HS/RS confusion):** The v1 verifier supporting both
  algorithms with shared key lookup is exactly how this class of
  vuln shipped at multiple real companies. ✅
- **V-20 (kid traversal):** `readFileSync(\`keys/\${kid}\`)`
  pattern. Looks like a normal key-rotation lookup. ✅
- **V-21 (refresh replay):** No `usedAt` field on `RefreshToken`
  is the realistic root cause. Engineers who haven't internalized
  refresh rotation routinely build it this way. ✅
- **V-35 (middleware bypass):** Short-circuit on
  `x-middleware-subrequest` is exactly the CVE-2025-29927 shape.
  Real teams wrote this code in real apps. ✅

**No vuln is too obvious.** None has tell comments. Approved.

## Architect resolutions for the open questions

1. **Shared `RefreshToken` table.** Real-world realistic — one
   refresh table serves both v1 and v2 issuers. V-21 exploit
   demonstrably affects both mounts.
2. **JWKS at the public well-known path.** `/api/.well-known/jwks.json`
   is the convention. Hiding it would be unrealistic.
3. **V-9 default string:** prefer `"changeme"`. It looks more
   accidental than `"bvbe-dev-secret-2022"`, which reads as
   deliberately-marked. The default should be plausibly-bad rather
   than telegraphed.
4. **OpenAPI registry:** **Do NOT** register `/api/v1/*` endpoints.
   Per the structural-gap principle from Phase 0, omission is the
   feature. v2 endpoints register; v1 endpoints don't.

## L7 follow-up integration

Vitest setup is included in the plan. Treat as Gate-1 condition:

- Vitest must be wired at the root with workspace-aware projects
- `make test` runs `vitest run` across the workspace
- At least 4 trivial round-trip tests ship (per plan)
- The fact that Phase 1 has tests sets the precedent for all later
  phases. The Phase-2 architect should reject any phase plan
  without a test section.

## Conditions for Gate 2 entry

1. ✅ V-9 default changed to `"changeme"` (per architect Q3)
2. ✅ RefreshToken table shared between v1 and v2 (per Q1)
3. ✅ JWKS at `/api/.well-known/jwks.json` (per Q2)
4. ✅ v1 endpoints NOT in OpenAPI registry (per Q4)
5. ✅ RSA legacy keypair generated specifically for this lab
   (Paranoid QA will verify by attempting to look it up via
   external sources)
6. ✅ Vitest scaffolding ships with the phase

## Surfaces still to leave clean (carried from Phase 0)

These reservations remain in force. Phase 1 must not introduce them:

- `/api/v1/internal/*` (Phase 8)
- nginx `proxy_cache_*` directives (Phase 4)
- nginx CL/TE-tolerant directives active (Phase 9)
- WebSocket server (Phase 4)
- `lodash` / deep-merge (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)

Paranoid QA will re-grep at Gate 4.

## Forward note for Phase 2

KYC document upload will introduce SSRF surface (CHAIN D building
block) and polyglot upload surface. The Phase-2 architect should
require: (a) URL-import feature with broken-guard SSRF, (b)
filename-not-normalized path traversal (V-14), (c) lexicographic
tier comparison (V-27). The seed users' KYC tier distribution
should be consumed by Phase 2's tier-gated limits.

## Verdict

**APPROVED.** Staff Eng may proceed to Gate 2 after the 6 conditions
above are reflected. Vuln placements are sound, scope is right-sized,
the clean-vs-vulnerable split is respected.

— Senior Architect
