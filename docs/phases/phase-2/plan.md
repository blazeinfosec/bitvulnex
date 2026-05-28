# Phase 2 — KYC & identity

> Input to Gate 1. Plants 4 vulnerabilities into the KYC surface. Two
> are from the master plan's allocation for this phase (V-14, V-27);
> two are CHAIN D building blocks named here for the first time
> (V-40 SSRF, V-41 polyglot XSS).

## Goal

Stand up the KYC tier system so users can submit identity profile +
documents, get reviewed by an admin, and unlock higher trading
limits. Phase 2 also lands the URL-import feature that will be the
SSRF entry-point for CHAIN D in later phases.

## Deliverables

### Schema

- `KycProfile` — 1:1 with `User`. Fields: `legalName`, `dateOfBirth`,
  `country` (ISO 3166-1 alpha-2), `addressLine`, `city`,
  `postalCode`, `submittedAt`, `reviewedAt`, `status`
  (`incomplete` / `pending` / `approved` / `rejected`),
  `reviewedById`, `rejectionReason`.
- `KycDocument` — N:1 with User. Fields: `id`, `userId`, `type`
  (`passport` / `id_card` / `address_proof`), `filename` (the
  original filename — used unsanitised in download URL, **V-14 site**),
  `storedPath` (path on disk), `mimeType`, `size`, `source`
  (`upload` / `url_import`), `createdAt`.
- Migration `20260529000000_phase_2_kyc`.

### Tier system

- `lib/kyc-tier.ts` — helpers:
  - `kycLimits(tier)` returns withdrawal cap, deposit cap, P2P
    enabled. Used by Phase 4+.
  - `requireTier(user, min)` — **V-27 site**: the implementation
    compares as strings (`user.kycTier < min`) because the function
    accepts `string | number` and a developer assumed string compare
    would "just work" since most callers pass the numeric tier.
- Tier 0 unverified, 1 email + basic profile, 2 docs reviewed,
  3 enhanced docs reviewed.

### API endpoints (v2 mount)

User-facing under `/api/v2/me/kyc/*`:

- `GET /api/v2/me/kyc` — read current state + docs
- `PUT /api/v2/me/kyc/profile` — submit/update profile fields
- `POST /api/v2/me/kyc/documents` — multipart upload, max 5 MB
- `POST /api/v2/me/kyc/import-url` — fetch a doc from a URL the user
  provides. **V-40 site** — SSRF guard blocks the literal string
  `127.0.0.1` and `localhost` but not `0.0.0.0`, decimal-encoded IPs,
  IPv6 mapped form, or DNS-rebinding domains. Used by CHAIN D to
  reach mock IMDS at `169.254.169.254`.
- `GET /api/v2/me/kyc/doc?file=...` — download a doc. **V-14 site**:
  `file` query param is joined to the uploads directory without
  normalization. `?file=../../etc/hostname` reads arbitrary host
  files.
- `POST /api/v2/me/kyc/submit` — finalize, move status to `pending`

Admin-facing under `/api/v2/admin/kyc/*` (gated by middleware admin
check, same V-35 surface):

- `GET /api/v2/admin/kyc/queue` — pending reviews
- `GET /api/v2/admin/kyc/{userId}` — single review
- `POST /api/v2/admin/kyc/{userId}/approve` — set tier + status
- `POST /api/v2/admin/kyc/{userId}/reject` — reason + status

### V-41 (polyglot XSS via admin review)

The admin review page renders user-uploaded documents in a preview
iframe whose `src` points at the user's `/api/v2/admin/kyc/{userId}/doc/{docId}`
endpoint. The endpoint **trusts the stored `mimeType`** and serves it
verbatim. An attacker uploads a polyglot PDF that begins with `%PDF-`
(passes naive MIME sniff at upload) but contains an embedded
`<script>` block, claiming `mimeType: "application/pdf"` — but
re-saves with content-type `text/html` via a follow-up rename API
(also planted, see below) OR uploads with a filename `evil.html` that
the upload handler keys mime-by-extension. When admin opens the
review page, the iframe loads with `Content-Type: text/html` and the
script runs in the admin's session origin → steals admin JWT.

Specifically the bug chain is:
1. Upload handler sets `mimeType` from filename extension if header
   is missing or `application/octet-stream`.
2. Admin doc-fetch handler emits `Content-Type: ${doc.mimeType}`
   without re-sniffing.
3. Admin review page renders an `<iframe>` for each doc, same origin.

This results in stored XSS only triggerable from an admin's session
— a high-impact, low-discoverability vuln.

### Tier-gated limits — wired to V-27

`lib/kyc-tier.ts` exports `requireTier(user, min)` which Phase 4+
will call. Phase 2 plants the bug and a single call site at
`/api/v2/me/kyc/import-url` ("URL import requires tier >= 1"). The
lexicographic comparison means a tier-3 user (`"3"`) is reported as
**less than** the required tier `"10"` if any caller ever passes
"10" — and more importantly, a string `"10"` (which Phase 4 might
pass when checking margin tier) is reported as less than `"3"`. The
trainee discovers V-27 by either reading the function or hitting an
unexpected denial.

### UI

- `/account/kyc` — multi-step form (profile, document upload, URL
  import option, submit)
- `/account/kyc/status` — current state, rejection reason if any
- `/admin` — admin landing (links to KYC queue, user list)
- `/admin/kyc` — pending review queue
- `/admin/kyc/[userId]` — individual review with embedded iframe per
  doc (V-41 surface)

All `/admin/*` pages render client-side and call admin APIs that the
middleware role-gates.

### File storage

- Uploads to `apps/web/uploads/kyc/` (in-container, ephemeral —
  wiped on `down -v` because the directory lives inside the web
  container's bind-mount, and the container itself is recreated).
- For URL imports: server fetches the URL, writes the response body
  to the uploads dir, records as `source: url_import`.
- Add `apps/web/uploads/.gitkeep` so the directory exists; gitignore
  any actual files.

### Mock IMDS (for CHAIN D landing)

Phase 2 also adds a tiny mock IMDS service to docker-compose. This
is a separate container that responds on `169.254.169.254` (mapped
via a docker network alias) with fake AWS-style instance metadata
including an IAM role + temporary credentials. The credentials are
synthetic (`AKIAIOSFODNN7EXAMPLE` shape) and not real.

The SSRF guard in `/api/v2/me/kyc/import-url` allows the request
through if the URL hostname resolves to `169.254.169.254` (via the
broken-guard logic), enabling CHAIN D's IMDS-to-IAM-creds step. The
chain's final step (using those creds against a mock S3) lands in
Phase 9.

### Tests

- `apps/web/lib/kyc-tier.test.ts` — round-trips `kycLimits()` but
  **does not** test `requireTier` (testing it would pin the
  vulnerable behavior with an obvious title)
- Optional: a tiny integration test for the upload happy-path

### Diegetic CHANGELOG entry

> "2026-05-29 — Phase 2: KYC. New tier-gated limits via
> `requireTier`. URL-import now accepts public document URLs (we
> block obvious local addresses). Document downloads are served
> directly from the uploads directory."

Hints at all three of V-14 ("served directly from the uploads
directory"), V-27 ("tier-gated via requireTier"), and V-40 ("we
block obvious local addresses").

## Vuln allocation (planted in this phase)

| Vuln | Category   | Difficulty | Location                                                   |
|------|-----------|------------|------------------------------------------------------------|
| V-14 | OWASP/Path | easy       | `/api/v2/me/kyc/doc` handler                                |
| V-27 | Auth/Logic | medium     | `apps/web/lib/kyc-tier.ts` (`requireTier`)                  |
| V-40 | SSRF       | medium     | `/api/v2/me/kyc/import-url` (SSRF guard) — CHAIN D component |
| V-41 | XSS/Upload | medium     | KYC upload + admin doc-fetch — adjacent to V-1, admin-target |

V-40 and V-41 are new V-NNN entries. The master plan said "~39
vulns total" with flexibility; we are now at 9 planted (V-8, V-9,
V-10, V-13, V-19, V-20, V-21, V-35) + 4 from Phase 2 = 13. The
total remaining catalog still tracks toward ~39.

## Exit criteria

1. All Phase 1 exit criteria still pass
2. KYC profile + document upload round-trip works end-to-end via UI
3. URL-import fetches a real (mock-IMDS or other internal) URL
4. Admin can list, view, approve, reject pending submissions
5. Approved submission upgrades user's `kycTier`
6. `requireTier` is callable from Phase-4-ready code paths (the bug
   exists and is reachable from at least one call site)
7. All 4 planted vulns have working PoCs in adversarial-qa.md
8. VULNS.md contains 4 new entries
9. Mock IMDS responds to `GET /latest/meta-data/iam/security-credentials/`
   from inside the docker network only
10. `surfaces to leave clean` grep still returns zero hits for
    still-reserved patterns (`/api/v1/internal/`, `proxy_cache_*`,
    CL/TE active, WebSocket server, `lodash`, `child_process`,
    `eval`, `$queryRawUnsafe`)

## Open questions for the architect

1. Should the polyglot XSS (V-41) be triggerable from a **user**
   visit to their own doc preview (broader impact) or **admin-only**
   (CHAIN B / impersonation-target pattern)? Plan says admin-only.
2. Should the SSRF (V-40) target the mock IMDS by default, or
   require the trainee to discover IMDS via OSINT (changelog hint,
   internal recon)? Plan says: the broken guard allows IMDS through
   directly — discovery is via reading the guard logic.
3. Should the mock IMDS container be exposed via nginx? No — it's
   internal-only on the docker network, only reachable via the SSRF
   primitive.
4. Should the V-27 lexicographic bug fire on the most common code
   path (the URL-import endpoint's `requireTier(user, 1)` call), or
   only when Phase 4+ passes a multi-digit tier? Plan says: Phase 2's
   one call site uses tier `1` (no bug visible yet); the bug manifests
   in Phase 4 when margin uses `"10"` as a tier label. This keeps
   V-27 medium-difficulty (read the code, don't trust the runtime).
