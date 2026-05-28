# Phase 2 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-05-29
> **Verdict:** Approved with conditions.

## Scope assessment

KYC is the natural Phase 2. Real exchanges layer it on after auth
(Phase 1) and before any deposit/withdraw/trade can exceed tier 0.
The vertical slice (DB + API + UI + tests) is correct.

## Vuln placement review

- **V-14 (path traversal in doc download):** Classic and realistic.
  `/api/v2/me/kyc/doc?file=...` joining to an uploads dir is exactly
  how careless teams build doc serving when their cloud bucket SDK
  feels overkill. ✅
- **V-27 (lex tier compare):** The function signature accepting
  `string | number` is the realistic root cause. Engineer assumed
  string compare would be fine "because tiers are single digits." ✅
- **V-40 (SSRF in URL-import):** Broken guard pattern — blocking
  literal strings but not the canonical bypass set (decimal-encoded
  IPs, `0.0.0.0`, IPv6-mapped, DNS rebinding). ✅
- **V-41 (polyglot XSS via admin review):** The "trust the stored
  mimeType verbatim" anti-pattern is well-known. The realistic root
  cause — mime detected from filename extension — is exactly what a
  team that read a "10 lines of code to upload files" tutorial would
  write. ✅

No vuln is too obvious. None have tell comments. Approved.

## Architect resolutions for the open questions

1. **V-41 admin-only.** Approved. CHAIN B's persistence step
   (planting a new admin) gets a juicier impersonation target this
   way. Trainees who upload a polyglot can't fire it on themselves
   without an admin victim — which makes the chain feel earned.
2. **SSRF discovery via reading the guard.** Approved. The
   /about/changelog diegetic hint ("we block obvious local addresses")
   is enough to flag the surface; trainees read the guard logic to
   find the bypasses.
3. **Mock IMDS internal-only.** Approved. No host port mapping. Add
   a `bvbe-imds` network alias for `169.254.169.254` so the SSRF can
   reach it by IP literal without DNS gymnastics in Phase 2 (DNS
   rebinding gymnastics live in Phase 9 polish if needed for chain
   teaching).
4. **V-27 latent in Phase 2.** Approved. Bug exists, is reachable,
   but the runtime payoff doesn't surface until Phase 4 passes a
   multi-digit tier. This keeps V-27 medium-difficulty (audit-tier,
   not crash-tier).

## Conditions for Gate 2 entry

1. ✅ Mock IMDS container with the synthetic `AKIAIOSFODNN7EXAMPLE`
   role-creds shape (well-known dummy from AWS docs — synthetic but
   recognisable, which makes the chain finding feel authentic)
2. ✅ V-40's SSRF guard documented in code with a comment that
   reads like a careful engineer's reasoning (no "// VULN HERE")
3. ✅ V-41's polyglot path documented in `VULNS.md` with the full
   chain (upload → trust mime → admin iframe)
4. ✅ V-27 ships with at least one **legitimate-numeric** call site
   (`requireTier(user, 1)` from URL-import) so the vuln exists
   without the runtime fire happening in Phase 2
5. ✅ Uploads directory under `apps/web/uploads/kyc/` with a `.gitkeep`
   and a gitignore line for `apps/web/uploads/*` (not `.gitkeep`)
6. ✅ Test for `kycLimits()` ships; **no** test for `requireTier`
   (testing the vuln would pin behavior by title)

## Surfaces still to leave clean (carried forward)

- `/api/v1/internal/*` (Phase 8)
- nginx `proxy_cache_*` (Phase 4)
- nginx CL/TE-tolerant directives active (Phase 9)
- WebSocket server (Phase 4)
- `lodash` / deep-merge (Phase 8)
- `child_process` / `exec` / `spawn` (Phase 8)
- `eval` / `node-serialize` / unsafe deserializers (later)
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8)

Paranoid QA will re-grep at Gate 4.

## Forward note for Phase 3

Deposit flow lands next, with V-24 (address validation bypass) and
zero-conf credit. The mock bitcoind node from Phase 0 finally gets
its first real integration. The Phase-3 architect should re-confirm
that the JSON-RPC contract types in `@bvbe/bitcoin-rpc-types` cover
every method Phase 3 plans to call.

## Verdict

**APPROVED.** Staff Eng may proceed to Gate 2 once the 6 conditions
above are reflected. KYC scope is right, vuln placements are
realistic, CHAIN D gets its first concrete building block (V-40 +
mock IMDS).

— Senior Architect
