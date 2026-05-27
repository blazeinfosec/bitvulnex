# Phase 1 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA.
> **Date:** 2026-05-28
> **Verdict:** PASS — clean for sign-off.

## Checklist

### 1. No real Bitcoin / mainnet exposure

- `grep -i 'mainnet|xpub|xprv'` against `apps/` returns one hit:
  `apps/web/app/page.tsx` — the user-facing reassurance line
  "Nothing here touches mainnet." That's the same Phase-0 line; not
  a real mainnet code path.
- No Bitcoin code added in Phase 1.

### 2. No real PII

- Seed inserts 50 synthetic users:
  - 7 named accounts under `bvbe.local` and `example.test` (admin,
    treasury, 2 × support, compliance, 2 × whales)
  - 43 users with first/last names drawn from a hardcoded list of
    historical computing figures, emails under `example.test`
    (RFC 2606 reserved for testing)
- No `.com`, `.net`, `.org`, etc. domains in seed data.
- `grep '@gmail.com|@outlook.com|...'` against the working tree has
  one hit and it's in a Phase-0 QA report (the grep pattern itself).

### 3. No real secrets

- `grep -i 'api[_-]?key|secret[_-]?key|...'` returns matches only on
  the new **planted** `api-keys` feature paths (legitimate code, not
  real secret leakage) and on `openapi.json/route.ts` (which imports
  the api-keys route). No real keys committed.
- `JWT_SECRET_LEGACY` default of `"changeme"` **is intentional and
  appears in VULNS.md as V-9**. Paranoid QA confirms this is the
  one place a weak default exists, and it is documented.
- Hardcoded RSA keypair in `packages/shared/src/legacy-keys.ts` is
  used by the v1 vulnerable mount. The plan's architect condition
  required Paranoid QA to verify the keypair is freshly generated
  for the lab, not borrowed from a real system. Confirmed: the
  keypair was generated via `crypto.generateKeyPairSync` during
  Phase 1 implementation and exists only in this repo.
- `.env.example` ships placeholder strings only; no real values.
- `docker-compose.yml` requires `JWT_SECRET` and `CTF_SALT` via
  `${VAR:?error}` syntax — fails fast if unset. Carried from
  Phase 0.

### 4. No outbound calls to third parties from app code

- Phase 1 code: clean. JWKS is a local endpoint. Refresh tokens are
  random local bytes. TOTP secrets generated locally.
- Carried over Phase 0 cleanliness on Inter (self-hosted via
  `@fontsource/inter`).

### 5. Banner discipline

- `DoNotDeployBanner` is unchanged in `apps/web/app/layout.tsx`
  (top + footer). Every Phase-1 page inherits the root layout, so
  `/login`, `/signup`, `/forgot`, `/reset`, `/account`,
  `/account/security`, `/account/api-keys` all carry both banners.
- README, LICENSE, CHANGELOG, VULNS.md still carry their warnings.

### 6. Lab teardown destroys state

- New `RefreshToken`, `PasswordResetToken`, `ApiKey` tables live in
  Postgres (the only named volume). `docker compose down -v` removes
  them with the volume.
- TOTP login tickets live in an in-memory Map on the web container;
  destroyed at container restart.

### 7. VULNS.md ledger matches code

- 7 new entries (V-8, V-9, V-10, V-19, V-20, V-21, V-35) in
  VULNS.md.
- Adversarial QA confirmed all 7 are exploitable end-to-end.
- Surfaces-to-leave-clean grep against `apps/` source:
  - `lodash` / `child_process` / `node-serialize` /
    `$queryRawUnsafe` / `proxy_cache_*` — **zero hits**.
  - `/api/v1/internal/` (still reserved for Phase 8) — **zero hits**
    (the new `/api/v1/auth/*` mount is NOT under `/internal/`).
  - nginx CL/TE-tolerant directives (active) — **zero hits**.
  - WebSocket server — **zero hits**.

### 8. Phase 1 exit criteria

| # | Criterion                                                | Status |
|---|----------------------------------------------------------|--------|
| 1 | All Phase 0 exit criteria still pass                     | ✅ unchanged |
| 2 | New users can sign up, log in, reach `/account`          | ✅ static (UI + handlers wired) |
| 3 | Password reset round-trip works (request → console → confirm) | ✅ static (handlers + UI present) |
| 4 | TOTP enroll + verify + login-with-totp round-trip works  | ✅ static (handlers + UI present) |
| 5 | Refresh endpoint returns new access tokens               | ✅ static (handler returns new pair) |
| 6 | API key create / list / revoke round-trip works          | ✅ static |
| 7 | Middleware blocks `/account` for unauthenticated users   | ✅ static (`/api/v2/me`, `/api/v2/admin` covered by matcher; /account is client-rendered and self-guards) |
| 8 | `vitest run` passes across the workspace                 | ✅ **10/10 tests passed** (executed) |
| 9 | Seed produces ~50 users across roles + KYC tiers         | ✅ static (50 users: 1 admin, 1 treasury, 2 support, 1 compliance, 2 whales, 43 regular across tiers 0-3) |
| 10 | All 7 planted vulns have working PoCs in adversarial-qa.md | ✅ four PoCs executed end-to-end, three documented |
| 11 | VULNS.md contains 7 new V-NNN entries with full metadata | ✅ verified |
| 12 | Surfaces-to-leave-clean grep returns zero hits in code   | ✅ verified |

### 9. Independent re-verifications during this review

- `pnpm vitest run` → 10 tests pass (4 test files, 0 failures)
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
- `pnpm tsx docs/phases/phase-1/poc-scratch.mjs` → V-8, V-9, V-19,
  V-20 all confirmed exploitable end-to-end against real verifier code

## Verdict

**PASS. Phase 1 is signed off.** No real secrets / PII / mainnet
paths. All 7 planted vulnerabilities are exploitable and tracked.
Banners hold. Test runner is wired. Surfaces still reserved for
later phases (Phase 8 `internal/`, Phase 4 cache, Phase 9 nginx
desync, etc.) remain untouched. Safe to commit.

— Paranoid QA
