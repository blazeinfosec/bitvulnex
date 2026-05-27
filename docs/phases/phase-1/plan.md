# Phase 1 — Authentication & user model

> Input to Gate 1. Phase 1 plants the first 7 vulnerabilities into the
> auth surface. The goal is for a careful auditor to find each one by
> reading code; none should appear via obvious tells.

## Goal

Stand up the full user-account lifecycle: signup, email verification
(simulated), login, refresh, logout, password reset, TOTP-based 2FA,
and scoped API keys. Includes the deliberately-vulnerable `/api/v1/*`
legacy mount that Phase 0 reserved.

## Deliverables

### Schema (`packages/db/prisma/schema.prisma`)

New models:

- `User` — extended with `displayName`, `emailVerified` (bool),
  `totpSecret` (nullable), `totpEnabled` (bool), `failedLogins`,
  `lockedUntil`
- `RefreshToken` — `id`, `userId`, `tokenHash`, `expiresAt`,
  `createdAt`. **No `usedAt` / `revokedAt` — deliberate (V-21).**
- `PasswordResetToken` — `id`, `userId`, `token` (the truncated
  predictable string), `expiresAt`, `createdAt`. **Stored in plain
  text** — looks normal because the token is short.
- `ApiKey` — `id`, `userId`, `name`, `keyHash`, `scopes` (string[]:
  `["read"]` / `["read","trade"]` / `["read","trade","withdraw"]`),
  `createdAt`, `lastUsedAt`

One new migration: `20260528000000_phase_1_auth`.

### Clean JWT layer (`packages/shared/src/jwt.ts`)

Phase 0 already shipped the clean v2 verifier. Phase 1 extends with
`issueRefreshToken`/`verifyRefreshToken`. Refresh tokens are random
32-byte values (not JWTs); stored hashed in `RefreshToken`. **The
verifier does not check single-use — V-21 plant.**

### Vulnerable v1 layer (`packages/shared/src/jwt-v1.ts`)

Per Phase-0 architect forward note, this is a **separate file**.
Used only by the `/api/v1/auth/*` route mounts.

- Accepts `alg: "none"` (V-8 plant)
- Accepts both `HS256` and `RS256`, looking up keys by `kid` from a
  `keys/<kid>` filesystem path (V-19 + V-20 plant — JWKS endpoint
  serves the RS256 public key, and `kid` is not normalized so `../`
  works)
- Realistic root cause: "legacy mobile-app compat shim from 2022"

### JWKS endpoint (`apps/web/app/api/.well-known/jwks.json/route.ts`)

Serves the RS256 public key (the "legacy" key) under a stable `kid`.
Hardcoded RSA keypair shipped in `packages/shared/src/legacy-keys.ts`
(synthetic; not a real key in use anywhere). Public side exposed at
the well-known path; private side used by the v1 issuer.

This is what enables V-19 (HS/RS confusion): the attacker fetches the
public key here, then signs a JWT with HS256 using the PEM bytes as
HMAC secret. The v1 verifier reads `alg: HS256` from the header,
loads the key for `kid` (the public key), and HMAC-verifies — which
succeeds because the attacker used the same bytes.

### V-9 (weak HMAC fallback)

Introduce a `JWT_SECRET_LEGACY` env var used only by the v1 verifier
in its HMAC mode. In `apps/web/lib/env.ts`:

```ts
JWT_SECRET_LEGACY: z.string().default("bvbe-dev-secret-2022"),
```

Defaulted to a publicly-known string in the repo. The clean v2 path
still requires `JWT_SECRET` >= 32 with no fallback (untouched).
Realistic root cause: "we used to hard-code the secret for early
dev; the .default keeps the legacy verifier working in test envs."

### Auth endpoints (clean v2)

Under `/api/v2/auth/*`:

- `POST /api/v2/auth/signup` — email + password + displayName,
  returns `{ access, refresh }`
- `POST /api/v2/auth/login` — email + password, returns
  `{ access, refresh }` or `{ totpRequired: true, ticket }` if 2FA on
- `POST /api/v2/auth/login/totp` — `{ ticket, code }`, completes
  2FA login
- `POST /api/v2/auth/refresh` — `{ refresh }`, returns new
  `{ access, refresh }`. **No rotation, no single-use — V-21 plant**
- `POST /api/v2/auth/logout` — revokes server-side refresh state
- `POST /api/v2/auth/password-reset/request` — `{ email }`, creates
  a `PasswordResetToken`. Logs the reset URL to server console
  (no real email service in lab). Token is
  `sha256(userId + Date.now()).slice(0, 16)` — **V-10 plant**.
- `POST /api/v2/auth/password-reset/confirm` — `{ token, newPassword }`
- `POST /api/v2/auth/2fa/enable` — issues TOTP secret + provisioning
  URI
- `POST /api/v2/auth/2fa/verify` — verifies first code; sets
  `totpEnabled`
- `POST /api/v2/auth/2fa/disable` — requires password + current code

### Auth endpoints (vulnerable v1 — legacy mobile compat)

Under `/api/v1/auth/*`:

- `POST /api/v1/auth/login` — same shape as v2 but issues legacy
  JWTs signed with the v1 layer (alg=HS256, kid="legacy-2022")
- `GET /api/v1/auth/me` — reads `Authorization: Bearer` with the
  vulnerable verifier (V-8, V-19, V-20 all reachable here)
- `POST /api/v1/auth/refresh` — same refresh table (no rotation;
  V-21 surface for v1 trainees too)

Both `/api/v1` and `/api/v2` are mounted. Real-world "legacy still
running for mobile app v1.x" pattern.

### Middleware (`apps/web/middleware.ts`)

New file. Protects `/account/*` and `/api/v2/me`. Reads
`Authorization: Bearer`, verifies via the clean v2 verifier, attaches
user context.

**V-35 plant:** the middleware short-circuits if
`x-middleware-subrequest` is present (CVE-2025-29927 shape). This
came in via "internal health-check skip" reasoning — a real careless
team would write this without realizing it's a bypass.

### Realistic seed (`packages/db/prisma/seed.ts`)

Extend to insert ~50 synthetic users:

- 1 admin (existing `admin@bvbe.local`)
- 2 support agents
- 1 compliance officer
- 1 treasury role
- ~45 regular users distributed across KYC tiers 0/1/2/3 and email-
  verified states
- All passwords hashed via scrypt with random salts
- Display names from the seed framework's curated computing-pioneer
  list
- Two "whale" accounts (`whale1@example.test`, `whale2@example.test`)
  reserved as later-phase attack targets

Idempotent (`upsert` on email).

### UI

- `/login` — replace the Phase-0 stub with a functional form
- `/signup` — replace stub with functional form
- `/forgot` — request password reset
- `/reset?token=...` — confirm password reset
- `/2fa/setup` — TOTP enrollment (shows QR + secret)
- `/account` — authenticated landing (email, displayName, KYC tier,
  2FA status, API keys list, "Sign out")
- `/account/api-keys` — list + create + revoke
- `/account/security` — password change, 2FA enable/disable

All authenticated pages live under `/account/*` and are protected by
the middleware.

### Testing (Vitest)

Per L7 review follow-up: introduce a workspace test runner. Vitest at
the root with workspace projects discovered automatically. Phase 1
ships:

- `packages/shared/src/jwt.test.ts` — round-trip the clean v2
  signer/verifier
- `packages/shared/src/jwt-v1.test.ts` — **does not exist** (we don't
  want a test pinning vulnerable behavior with an obvious title; the
  vuln behavior is covered by Adversarial QA's PoC, not by unit tests)
- `apps/web/lib/env.test.ts` — verify zod schema rejects bad inputs
- `apps/web/lib/openapi-registry.test.ts` — round-trip register +
  build

`make test` now runs `vitest run` across the workspace.

### Changelog (diegetic hints)

Append two entries to `CHANGELOG.md`:

- "2026-05-28 — Phase 1: auth surface (v2 endpoints). Legacy v1
  remains mounted for mobile app v1.x compatibility." — hints
  that v1 is suspicious without spelling out the vulns.
- "Note: refresh tokens are not yet rotated on use. Tracking ticket
  AUTH-114." — hints at V-21 without literally saying "vulnerable."

## Vuln allocation (planted in this phase)

| Vuln | Category   | Difficulty | Location                                   |
|------|-----------|------------|--------------------------------------------|
| V-8  | OWASP/Auth | easy       | `packages/shared/src/jwt-v1.ts`            |
| V-9  | Auth/Infra | easy       | `apps/web/lib/env.ts` + jwt-v1 HMAC mode   |
| V-10 | Auth       | easy       | v2 password-reset/request route            |
| V-19 | Auth       | medium     | `packages/shared/src/jwt-v1.ts` + JWKS     |
| V-20 | Auth       | medium     | `packages/shared/src/jwt-v1.ts`            |
| V-21 | Auth       | hard       | refresh endpoint + RefreshToken model      |
| V-35 | Framework  | hard       | `apps/web/middleware.ts`                   |

## Exit criteria

1. All Phase 0 exit criteria still pass
2. New users can sign up, log in, and reach `/account`
3. Password reset round-trip works (request → console URL → confirm)
4. TOTP enroll + verify + login-with-totp round-trip works
5. Refresh endpoint returns new access tokens
6. API key create / list / revoke round-trip works
7. Middleware blocks `/account` for unauthenticated users
8. `vitest run` passes across the workspace (≥4 trivial tests)
9. Seed produces ~50 users across roles + KYC tiers
10. All 7 planted vulns have working PoCs in adversarial-qa.md
11. VULNS.md contains 7 new V-NNN entries with full metadata
12. `surfaces to leave clean` grep still returns zero hits in code
    for the still-reserved patterns

## Open questions for the architect

1. Should v1 and v2 share the same `RefreshToken` table (so V-21
   exploit works against both mounts), or should they be separate?
   Sharing is more realistic — most teams have one refresh table.
2. Should the JWKS endpoint be public (`/api/.well-known/jwks.json`)
   or hidden under `/api/v1/...`? Public matches real-world JWKS
   convention and gives the attacker an obvious recon target.
3. For V-9 fallback default value — `"bvbe-dev-secret-2022"` is
   recognizably synthetic. Alternative is something that looks more
   accidental like `"changeme"`. Which feels more realistic?
4. Should we register the v1 endpoints in the OpenAPI registry? Per
   the architect's "structural gap" principle from Phase 0, NOT
   registering them makes the gap structural. Confirm.
