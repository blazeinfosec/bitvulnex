# Planted Vulnerability Ledger

> Source of truth for every **intentional** vulnerability in BVBE.
> If a flaw exists in the code but is not listed here, it is an
> unintended bug — please open an issue. If a flaw is listed here,
> it is a feature.
>
> This file is part of the lab materials. It is **not** linked from
> any attacker-facing page. It is for instructors, the dev/QA loop,
> and post-exercise debriefs.

## Format

Each entry:

```
### V-NNN: <short title>
- Category: OWASP / Crypto / Business / Infra
- Phase introduced: N.M
- Location: path/to/file.ts:LINE (or "multiple", with list)
- Exploitation path: 1-3 sentence summary of how to trigger it
- Intended discovery difficulty: easy / medium / hard / expert
- Realistic root cause: what a careless developer would have done
- Remediation: how a real team would fix it
- Chain membership: standalone | CHAIN A | CHAIN B | CHAIN C | CHAIN D
```

---

## Phase 0 — Scaffolding & safety rails

**No planted vulnerabilities.** Phase 0 is the clean foundation.

---

## Phase 1 — Authentication & user model

### V-13: Open redirect via login `?next=` parameter

- **Category:** OWASP / Auth
- **Phase introduced:** 1 (relocated from the master plan's Phase-7 slot — login surface lands earlier than withdraw/callback)
- **Location:** `apps/web/app/login/login-form.tsx` (the `nextPath = params.get("next") ?? "/account"` line and the subsequent `router.push(nextPath ...)`)
- **Exploitation path:** Craft a URL like `http://exchange.local/login?next=//attacker.example/phish` or `?next=https://attacker.example`. After successful authentication the SPA passes the raw `next` value to `router.push`; in some Next.js + browser combinations protocol-relative and absolute URLs are honored, navigating the freshly-authenticated user off-origin. Pairs well with a phishing page that mirrors the BVBE login screen and harvests the legitimate access/refresh pair from `postMessage` or referer.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer copy-pasted a `?next=` pattern from another product without whitelisting the value to same-origin paths. Looks like normal "preserve the user's destination" UX code.
- **Remediation:** Whitelist `next` before pushing — require leading `/` and reject `//` and `/\` prefixes. A small `safeNext(next, fallback)` helper is the canonical fix.
- **Chain membership:** standalone (and an OAuth-code-interception primitive once Phase 1+ social login lands — but we don't have OAuth in scope per locked decisions)

### V-8: JWT alg=none accepted by legacy v1 verifier

- **Category:** OWASP / Auth
- **Phase introduced:** 1
- **Location:** `packages/shared/src/jwt-v1.ts` (`verifyAccessTokenV1` — the `alg === "none"` branch)
- **Exploitation path:** Mint a JWT with header `{"alg":"none","typ":"JWT"}`, an attacker-chosen payload, and an empty signature. Send to `GET /api/v1/auth/me` as `Authorization: Bearer <token>`. The verifier accepts and returns the user identity claimed in the payload.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer maintaining the "legacy mobile app v1.x" compatibility module forgot to remove the `alg=none` path that supported a brief window of unsigned tokens from early mobile builds.
- **Remediation:** Drop the `alg=none` branch entirely. Reject any header whose `alg` isn't an explicit allow-listed signing algorithm.
- **Chain membership:** standalone (also useful as a foothold for CHAIN A — forge admin claims)

### V-9: Legacy HMAC fallback secret is a known weak default

- **Category:** Auth / Infra
- **Phase introduced:** 1
- **Location:** `apps/web/lib/env.ts` (`JWT_SECRET_LEGACY` schema, `.default("changeme")`) and the `legacySecret` branch in `packages/shared/src/jwt-v1.ts`
- **Exploitation path:** Mint a JWT with `{"alg":"HS256","typ":"JWT"}` (no `kid`). Sign with HMAC-SHA256 using the string `"changeme"`. The v1 verifier reads the missing `kid`, falls through to the env-provided legacy secret which defaults to `"changeme"`, and verifies.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer added a `.default` on the legacy env var so the v1 verifier would "just work" in dev environments where the variable wasn't set. The default value got committed.
- **Remediation:** Remove the `.default()` so the schema requires explicit configuration; rotate the legacy key out of the codebase.
- **Chain membership:** standalone

### V-10: Password reset token is predictable

- **Category:** Auth
- **Phase introduced:** 1
- **Location:** `apps/web/app/api/v2/auth/password-reset/request/route.ts` (`generateResetToken`)
- **Exploitation path:** Token is `sha256(userId + Date.now()).slice(0, 16)`. Request a reset for the victim's email; the server logs the URL to console. Independently, an attacker who knows a victim's `userId` (leaked via signup race / IDOR) can enumerate `Date.now()` values around their best estimate of the request time (~ms granularity → ~1000 candidates/sec) and brute-force the 16-hex-char token via `POST /api/v2/auth/password-reset/confirm`.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer wrote "secure-looking" token generation but used `Date.now()` as the only entropy source. Code review didn't catch it because `sha256` made it look strong.
- **Remediation:** Use `crypto.randomBytes(32).toString("base64url")` for the token; store the hash, not the token; constant-time compare.
- **Chain membership:** standalone

### V-19: HS256/RS256 key confusion via JWKS

- **Category:** Auth
- **Phase introduced:** 1
- **Location:** `packages/shared/src/jwt-v1.ts` (HS256 + RS256 branches sharing the same `loadKidKey` lookup) plus `apps/web/app/api/.well-known/jwks.json/route.ts`
- **Exploitation path:** Fetch `/api/.well-known/jwks.json` to obtain the RS256 public key (kid `legacy-2022`). Convert the JWK back to PEM (or read the bytes the v1 verifier will load — same content as `apps/web/keys/legacy-2022`). Mint a JWT with `{"alg":"HS256","kid":"legacy-2022"}` and arbitrary claims; sign with HMAC-SHA256 using the PEM bytes as the HMAC secret. Send to `GET /api/v1/auth/me`. The verifier reads `alg=HS256`, loads the kid-mapped file (PEM bytes), uses them as the HMAC secret, and accepts.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** v1 verifier supports both algorithms with a shared key lookup table. The team didn't realize the algorithm choice should be tied to the key type.
- **Remediation:** Tie algorithm to key type at lookup time; if `kid` maps to an RSA key, only RS256 verification is allowed.
- **Chain membership:** standalone (and a foothold for CHAIN A — forge any role)

### V-20: kid header path traversal

- **Category:** Auth
- **Phase introduced:** 1
- **Location:** `packages/shared/src/jwt-v1.ts` (`loadKidKey`)
- **Exploitation path:** Set `kid` in the JWT header to a path-traversal string like `../../../etc/hostname` or a process-readable file with known contents (e.g., `package.json`). The verifier reads that file and uses its contents as the HMAC secret. Sign the JWT with HMAC-SHA256 using the same file's bytes as secret. Send to `GET /api/v1/auth/me`.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Filesystem-based key rotation pattern that joins `kid` directly into a path without `path.basename()` or any whitelist.
- **Remediation:** Whitelist `kid` against a static set of permitted values, or use `path.basename` and verify the canonical path stays under the keys directory.
- **Chain membership:** standalone

### V-21: Refresh tokens are not single-use

- **Category:** Auth
- **Phase introduced:** 1
- **Location:** `apps/web/app/api/v2/auth/refresh/route.ts` (handler issues a new pair but does not delete or mark the old `RefreshToken`) and `packages/db/prisma/schema.prisma` (no `usedAt` / `revokedAt` field on the model)
- **Exploitation path:** Capture a victim's refresh token (any vector — XSS to localStorage, leaked log line, MITM in a misconfigured deployment). The captured token continues to mint new access tokens for the full 30-day TTL, even after the legitimate user refreshes. Confirm by calling `POST /api/v2/auth/refresh` repeatedly with the same body.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Engineer assumed refresh tokens are "rotated naturally" because each call returns a new one. Forgot to invalidate the old.
- **Remediation:** Mark the consumed token used (or delete it) in the same DB transaction that creates the new one; reject any refresh whose token-hash row already has `usedAt`.
- **Chain membership:** standalone

### V-35: Next.js middleware bypass via x-middleware-subrequest

- **Category:** Framework / Auth
- **Phase introduced:** 1
- **Location:** `apps/web/middleware.ts` (the early `if (req.headers.get("x-middleware-subrequest")) return NextResponse.next()` branch)
- **Exploitation path:** Send `x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware` (or any non-empty value) on the request to `GET /api/v2/admin/users` or `POST /api/v2/admin/users`. Middleware short-circuits before the role check. The downstream admin handler trusts `x-bvbe-user-id` (also sent by the attacker) and acts. Useful for listing the full user DB and for minting fresh admin users.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** CVE-2025-29927 shape. Engineer added the header check thinking it would let internal probes skip auth without realizing the header is attacker-controllable.
- **Remediation:** Remove the bypass. If internal subrequests need to skip auth, identify them by something the attacker cannot supply (network position, signed shared secret, etc.).
- **Chain membership:** CHAIN B (component) — bypass to reach the admin mount, plant an admin user, persist.

---

## Killer chains — current state

- **CHAIN A — Drain the hot wallet:** components landed = V-19 (forge admin JWT). Remaining: leaked secret + treasury endpoint + PSBT signing flaw (Phase 7-9).
- **CHAIN B — Become admin and persist:** components landed = V-35 (middleware bypass) + admin user-creation endpoint (planted admin via mass assignment will be added in Phase 4 via V-7). Remaining: smuggling at nginx (Phase 9).
- **CHAIN C — Mass user takeover:** no components yet (price feed + self-trade Phase 4).
- **CHAIN D — Exfiltrate full user DB + KYC:** no components yet (SSRF + IMDS in Phase 2/9).
