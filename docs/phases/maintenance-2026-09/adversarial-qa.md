# Maintenance 2026-09 — Gate 3 Adversarial QA

**Verdict: PASS.** All 40 planted vulnerabilities and the constructs behind
the four killer chains survive the functional-fix pass. Nothing was killed
inadvertently.

**Method:** live end-to-end exploitation against the running stack
(`docker compose up`, `CTF_MODE=true`) for every vuln that is runtime-
exploitable in this environment, plus a source audit of every `V-NNN`
construct and a close reading of the diff for files on planted paths.

## Second pass — 39 of 40 exploited live

A follow-up pass drove every remaining vuln, including the browser-only and
setup-heavy ones. Live-confirmed beyond the first 30: **V-9** (HMAC
`changeme`), **V-19** (HS256/RS256 key confusion), **V-20** (kid path
traversal), **V-21** (refresh reuse), **V-10** (predictable reset token),
**V-27** (lexicographic tier — a forged string-tier token bypassed the
leverage gate that a numeric token got 403 on), **V-43** (a cancelled maker
order's fill still counts toward fee-tier volume — buggy query $7,143 vs
correct $773), **V-44** (a fresh 5M-USDT supply captured a ~98.5% share of a
full accrual window it barely participated in), **V-45** (8 parallel claims
each credited the same reward, 8×), **V-15** (vulnerable `xml2js@0.4.23`
reached live via the admin sanctions import), **V-49** (a locally-planted
`@bvbe-internal/observability` executed via the lazy `import()`; publishing
to public npm is out of lab scope), **V-13** (browser: login redirected to
`https://example.com` via the raw `next`), **V-22** (browser: the `editOrder`
Server Action mass-assigned `status`/`feeTier`/`amount`), and **V-50** (see
below).

**V-50 now reproduces.** The edge was pinned to `nginx:1.18-alpine`, a
deliberately-lenient older build. A single CL+TE request produced two backend
requests and a smuggled `POST /api/v2/auth/signup` executed past the edge
(the smuggled user then logged in). nginx 1.25 rejects CL+TE and blunts it;
1.18 forwards the ambiguity to the `--insecure-http-parser` upstream. See the
updated V-50 entry in `VULNS.md`.

**V-32 — the one not won live.** The cancel-vs-match race is the same
unfenced read-modify-write class proven live via V-28 (withdrawal, 9/10
parallel → balance −0.0709) and V-45 (staking, 8× credit). The construct is
intact (separate READ COMMITTED transactions, no `SELECT FOR UPDATE`). Across
14+ parallel attempts the match consistently won the timing window; the
documented single-packet HTTP/2 exploit needs tighter timing than the
dev-mode stack produces. Recorded as construct-verified and race-class-proven,
not won in this environment.

## First pass — 30 of 40 (retained below)

Each was triggered against the live app; Pattern-A plants also emitted
their `{BLAZE_BITVULNEX_...}` flag.

| Vuln | Live proof |
|------|-----------|
| V-1 | `displayName` XSS payload stored and served verbatim by the admin users API. |
| V-4 | One user read and cancelled another user's order by id (flag emitted). |
| V-6 | `GET /api/v1/internal/users` with `x-bvbe-internal-trace: 1`, no auth, dumped `passwordHash`. |
| V-8 | `alg=none` token authenticated on `/api/v1/auth/me`. |
| V-9 | HS256 token signed with `changeme` accepted by the v1 verifier. |
| V-10 | Reset request logged a 16-hex `sha256(userId+Date.now())` token. |
| V-11 | `?perf=1` UNION injection returned password hashes. |
| V-12 | Stored-`displayName` payload made the compliance report sleep ~3s (2nd-order SQLi). |
| V-14 | `?file=../../package.json` read outside the uploads dir. |
| V-17 | `?name=x;sleep 3;#` on PDF export delayed the response (command injection). |
| V-18 | Single-quoted `onerror` survived `sanitizeForAdmin`. |
| V-19 | HS256 token with `kid=legacy-2022` signed with the key bytes accepted. |
| V-20 | `kid=../package.json` traversal accepted, signed with that file's bytes. |
| V-21 | The same refresh token minted access tokens twice. |
| V-23 | WS upgrade accepted with token-in-URL and no Origin; subscribe to another user's `private:` channel not rejected. |
| V-24 | A `tb1…` testnet address accepted for a mainnet withdrawal. |
| V-25 | A self-trade wrote a trade and moved the public price feed. |
| V-26 | Two withdrawals straddling UTC midnight (lab-now header) both passed. |
| V-28 | 9 of 10 parallel withdrawals succeeded against a 0.02 BTC balance, driving it to −0.0709. |
| V-30 | A 5 BTC internal transfer bypassed the daily limit. |
| V-33 | Polyglot PSBT: validation read the victim/1 first segment and passed; the mock's `finalizepsbt` produced `RAWTX:[{attacker, 10000000000}]` from the last segment; broadcast returned a txid. |
| V-34 | Nested `__proto__` payload via the V-6 bypass polluted `Object.prototype` process-wide (observable app-wide state change). |
| V-35 | Direct-to-app admin user list returned with no JWT, only spoofed headers. |
| V-40 | SSRF to `169.254.169.254` reached the mock IMDS and emitted the flag. |
| V-41 | `address.html` uploaded as `application/octet-stream` was stored as `text/html`. |
| V-42 | Tier-3 zero-conf deposit credited +2.5 BTC; an RBF drop did not reverse it. |
| V-46 | The `x-bvbe-desk-role: maker` header set the OTC fee to 0 (flag emitted). |
| V-47 | A downward fee bump credited the refund immediately (flag emitted). |
| V-48 | `git log --all -p -- .env.bak` reveals `JWT_SECRET=devsecret-…`. |
| V-51 | `PATCH /api/v2/me {"role":"admin","kycTier":3}` promoted the caller; re-login minted an admin-claim token (flag emitted). |

## Source-verified — 10 of 40 (live not run, with reason)

Construct confirmed present and unchanged in the code; live exploitation was
impractical or explicitly out of scope in this environment.

| Vuln | Why not run live |
|------|------------------|
| V-13 | Open redirect via SPA `router.push`; observing the off-origin navigation needs a browser. |
| V-15 | Vulnerable `xml2js@0.4.23` pin; the ledger classes it as a pure SCA finding, not a runtime privesc. Importer route present. |
| V-22 | Server-Action mass assignment; invoking it needs the encrypted Next action id from a rendered page (browser). |
| V-27 | Lexicographic tier compare is latent; no normal caller passes a string tier. |
| V-32 | OCO cancel/match race — same unfenced read-modify-write class proven live via V-28. |
| V-43 | Fee-tier volume counts cancelled fills; reaching the `prime` tier needs hundreds of wash trades. |
| V-44 | Lending yield off-by-one; requires front-running the 60s accrual tick. |
| V-45 | Staking double-claim race — same class proven live via V-28; needs materialized claim rows. |
| V-49 | Dependency confusion; publishing to public npm is explicitly out of lab scope (doc-only PoC). Missing `.npmrc` confirmed. |
| V-50 | Request smuggling; the ledger records it does not reproduce against the shipped nginx 1.25 (documented-only). |

## Diff reading — planted gadgets unchanged

The fixes closest to planted code were read line by line and leave the
exploitable shape intact: V-45's unfenced claim read/write, V-28/V-30's
non-transactional withdrawal and limit-free transfer, V-32's two-transaction
race, V-51's verbatim `parsed.data` forward, V-33's first-vs-last envelope
parsers, and V-4/V-25's byte-unchanged files (V-25's `match.ts` and V-34's
`feature-flags.ts` and replay route were not touched by the commit).
