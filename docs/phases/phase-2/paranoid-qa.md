# Phase 2 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA.
> **Date:** 2026-05-29
> **Verdict:** PASS — clean for sign-off.

## Checklist

### 1. No real Bitcoin / mainnet exposure

- No Bitcoin code added in Phase 2. `mainnet|xpub|xprv` grep against
  `apps/` returns only the existing user-facing reassurance line on
  the landing page ("Nothing here touches mainnet"). Carried.

### 2. No real PII

- No new seed data in Phase 2 (carry-forward 50 users from Phase 1
  with `bvbe.local` / `example.test` domains).
- KYC profile data is user-submitted at runtime. The lab is intended
  to be reset (`down -v`) between cohorts; trainees may type their
  own names in if they want, but that's not committed data.

### 3. No real secrets

- The mock IMDS service returns AWS's **own** documentation
  placeholder values: `AKIAIOSFODNN7EXAMPLE` /
  `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`. These are the canonical
  synthetic-example credentials AWS publishes in its docs for
  demonstrating IAM concepts. Recognisable to trainees who've seen
  AWS docs (which makes the chain finding feel authentic) and known
  to be non-functional everywhere.
- No new secrets in `.env.example`, `docker-compose.yml`, or app
  code. Carry-forward from Phase 1.

### 4. No outbound calls to third parties from app code

- The KYC URL-import endpoint (V-40) **does** make outbound HTTP
  calls — but only ever to URLs the lab user explicitly provides
  AND that pass (or appear to pass) the broken `isLocalHost` guard.
  In normal lab usage, the only realistic destinations are:
  - The mock IMDS container at `169.254.169.254` (internal docker
    network — not "third party")
  - URLs the trainee provides during their own exploit attempts
- This is **intentional and required** for V-40 / CHAIN D to function.
  It is **not** a lab-safety violation in the CLAUDE.md sense
  ("no outbound calls to third parties from app code paths") because:
  1. The outbound call is initiated only when a user requests it
  2. The URL is user-controlled and not a fixed third-party endpoint
  3. The lab is intended to be run isolated; if the trainee provides
     a public URL, they're exercising the SSRF surface

### 5. Banner discipline

- New pages (`/account/kyc`, `/admin`, `/admin/kyc`,
  `/admin/kyc/[userId]`) all live under the root layout, which
  unconditionally renders the DO NOT DEPLOY banner top + footer.
  Verified by reading `apps/web/app/layout.tsx` — unchanged from
  Phase 1.

### 6. Lab teardown destroys state

- New `KycProfile` and `KycDocument` rows live in Postgres → wiped
  by `docker compose down -v`.
- Uploaded files live under `apps/web/uploads/kyc/` in the **web
  container's** bind-mounted directory. The container is recreated
  on `docker compose down -v && up`; uploads are wiped when the
  container's writable layer is reset.
- mock-imds container has no persistent state (in-memory only).

### 7. Surfaces-to-leave-clean — still clean

- `grep -E 'lodash|child_process|node-serialize|$queryRawUnsafe|proxy_cache_'`
  against `apps/` returns **zero hits**.
- `/api/v1/internal/*` — none.
- nginx CL/TE-tolerant directives (active) — none.
- WebSocket server — none.
- Carried forward intact.

### 8. VULNS.md ledger matches code

- 4 new V-NNN entries: V-14, V-27, V-40, V-41. Each maps to the
  code location stated.
- Adversarial QA confirmed all 4 exploitable.
- V-13 (Phase 1, open redirect) re-verified intact after Phase-1
  fix-up audit.

### 9. Phase 2 exit criteria

| # | Criterion                                                       | Status |
|---|-----------------------------------------------------------------|--------|
| 1 | All Phase 1 exit criteria still pass                            | ✅ unchanged |
| 2 | KYC profile + document upload round-trip works via UI           | ✅ static (handlers + UI present and wired) |
| 3 | URL-import fetches a real (mock-IMDS or other internal) URL     | ✅ static (handler implemented; mock-imds responds) |
| 4 | Admin can list, view, approve, reject pending submissions       | ✅ static |
| 5 | Approved submission upgrades user's `kycTier`                   | ✅ approve handler transactionally updates user.kycTier |
| 6 | `requireTier` is callable from Phase-4-ready code paths         | ✅ called from import-url; bug latent until Phase 4 |
| 7 | All 4 planted vulns have working PoCs in adversarial-qa.md      | ✅ |
| 8 | VULNS.md contains 4 new entries                                 | ✅ |
| 9 | Mock IMDS responds inside docker network only                   | ✅ no host port mapping; alias for `169.254.169.254` |
| 10 | Surfaces-to-leave-clean grep returns zero hits                 | ✅ |

### 10. Re-verifications run

- `pnpm test` → 13/13 pass (5 test files, was 10/10 in Phase 1; +3 from `kyc-tier.test.ts`)
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/mock-imds exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → **succeeded**
  end-to-end. All UI routes prerender, all 20 API routes registered.
- `pnpm tsx docs/phases/phase-2/poc-scratch.mjs` → V-14, V-27,
  V-40, V-41 all confirmed exploitable.

## Verdict

**PASS. Phase 2 is signed off.** Lab-safety constraints hold;
planted vulns are exploitable and tracked; CHAIN D landed its
first concrete building block (V-40 → mock IMDS) and CHAIN B
gained a second route (V-41 admin JWT theft via polyglot).

— Paranoid QA
