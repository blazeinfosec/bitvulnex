# Phase 9 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-07-01
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 9 is the **shipping phase**. It doesn't add product
surface; it activates the supply-chain and infrastructure
primitives that turn Phase 5-8's planted catalog into externally-
executable attack chains. The four plants here (V-15, V-48, V-49,
V-50) are *supply-chain plants* — they live in git history, in
configuration, in lockfiles. They look nothing like the
application-code plants of Phases 1-8.

The most consequential plant is **V-48** (git-history JWT secret).
Without it, CHAIN A requires insider access. With it, a trainee
who's reached the "scan the repo for secrets" step (a standard
recon move) closes the loop on a nine-figure-class incident.

## Vuln placement review

Four plants approved. Numbers V-15, V-48, V-49, V-50.

### V-15 — Vulnerable transitive dep (xml2js@0.4.23)

**Approved with structural condition.** Use `xml2js@0.4.23`
(CVE-2023-0842, prototype pollution via untrusted XML). Realistic,
recent, documented on the dev's package landing page. The
**OFAC sanctions importer** stub is the right framing:
real exchanges have exactly this kind of compliance feature, and
they're often built in a hurry by a single engineer.

**Structural condition**: the importer endpoint MUST be
admin-gated via `requireAdmin`. The reach is "admin who imports
a malicious XML." Realistic insider-threat or
admin-with-compromised-creds scenario. The plant doesn't need to
be reachable by unauthenticated callers — that would make it too
easy.

`xml2js.parseString` with the default options DOES allow
`__proto__`-style pollution from XML elements named
`<__proto__>`. The architect verified this in a sandbox.

The pollution reaches V-34's `resolveFlags` reader at runtime
because they share the `Object.prototype` sink. Two plant paths,
one downstream effect — that's instructive for trainees.

### V-48 — Git-history JWT-key leak

**Approved with framing condition.** Two commits: one adds
`.env.bak`, the next removes it. Commit messages must look
realistic — not "added secret for V-48" but something like:

- Add commit: "ops: archive .env for rollback during phase-7 hotfix"
- Remove commit: "ops: remove .env.bak (committed in error)"

The secret value: `devsecret-do-not-use-in-prod-bvbe-2026`. The
`.env.bak` should set `JWT_SECRET` AND `JWT_SECRET_LEGACY` AND a
fake `DATABASE_URL` with embedded password (e.g.
`postgresql://bvbe:bvbe-prod-pw-2024@db:5432/bvbe`) to look like a
real ops artifact.

**The lab's runtime JWT_SECRET MUST equal the .env.bak value.**
Otherwise the discovered secret doesn't actually verify against
the running app. Update `.env.example` and Phase 0's default to
match the .env.bak value, OR — cleaner — make the runtime
`JWT_SECRET` env variable in `docker-compose.yml` be the
.env.bak value directly. The Phase-0 `.env.example` placeholder
already says "replace before running"; the architect blesses
hardcoding the lab JWT secret in `docker-compose.yml` as the
discoverable target.

Wait — `docker-compose.yml`'s `JWT_SECRET` env line currently
references `${JWT_SECRET}` from a host `.env` file. The lab
runtime needs a CONCRETE secret. Cleanest setup: the
`docker-compose.yml` line becomes literal: `JWT_SECRET:
devsecret-do-not-use-in-prod-bvbe-2026`. That way trainees who
find `.env.bak` in git history confirm the value matches
`docker-compose.yml`, forge a JWT, and authenticate.

### V-49 — Dependency confusion artifact

**Approved.** Add `optionalDependencies` reference to
`@bvbe-internal/observability` in `apps/web/package.json`.
Documentation-only PoC. The `apps/web/lib/observability.ts`
stub does a `try { import(...) } catch {}` so build works
without the package. No `.npmrc` at repo root.

**Architect adds:** include a brief note in CHANGELOG.md hinting
at this: "Observability hooks now wire through the
@bvbe-internal/observability stub when available" — that
mentions the private-scope name diegetically.

### V-50 — nginx CL/TE-tolerant configuration

**Approved.** Add the three directives the plan specifies:
```nginx
proxy_pass_request_headers on;
ignore_invalid_headers off;
underscores_in_headers on;
```

Place them inside the main `location /` block (the one that
proxies to the upstream Next.js).

The realistic root cause comment in the config should read:

```nginx
# Forward all client headers to upstream for legacy mobile-app
# compatibility (see OPS-2024-117). Includes Content-Length and
# Transfer-Encoding when both are present — the upstream Node
# service handles the decision.
```

**Architect's CHAIN B reframing.** The plan suggests smuggling
`PATCH /api/v2/me` with `role: "admin"`. The architect checked:
V-22 (mass assignment) is on `/me` profile updates and accepts
`role` via Server Action — confirmed exploitable. CHAIN B works
without a new plant.

But there's a simpler narrative: the smuggle just needs to
bypass the auth middleware on a route that wouldn't be reachable
otherwise. The cleanest demo: smuggle `POST
/api/v1/internal/treasury/emergency-withdraw` directly, without
needing the V-6 header — because the smuggled request inherits
the connection state of a legitimate authenticated user pipelined
behind it. **That's actually CHAIN A reach by a different
mechanism**, not CHAIN B.

For CHAIN B to be distinct, it needs admin **persistence**.
Architect picks the **V-22 + smuggle** path:
1. CL/TE smuggle a `PATCH /api/v2/me` with `{role: "admin"}`
   into a legitimate user's connection.
2. Now-admin attacker creates a new user via admin endpoint
   AND updates the seed-poison file (or just plants a second
   admin row).
3. Disabling changelog is a stretch goal — skip; instead,
   demonstrate persistence by surviving a `docker-compose down`
   (no `-v`).

### Phase 8 L7 housekeeping

**Resolutions:**

1. **V-34 PoC text drift.** Fix the VULNS.md entry to describe
   the nested form `{"config":{"a":{"__proto__":{...}}}}`.
   Take the opportunity to also document that the inline test in
   `feature-flags.test.ts` is a sanitized demonstration (bypasses
   zod) and the END-TO-END route reach requires the nested form.
2. **OpenAPI registry drift.** Architect picks: register **all
   24 endpoints** (the right course). Single sweep — not worth
   carrying as a permanent debt.
3. **balance-adjust 500 → 404.** Trivial fix.
4. **Navbar Support anon gating.** Trivial fix.
5. **Admin landing Treasury sub-nav.** Trivial fix.

### Mock IMDS service for CHAIN D

Architect checked: there is **no** mock-imds service in the
current docker-compose. CHAIN D's SSRF path through V-40 reaches
the docker network but has nowhere to go from there.

**Phase 9 adds `mock-imds`** as a docker-compose service:
- Image: `node:20-alpine` with a tiny Express app
- Network alias: `metadata.bvbe.internal` (not `169.254.169.254` —
  that requires host network manipulation; alias is sufficient
  for the lab)
- Responds on `/latest/meta-data/iam/security-credentials/`
  with a fake IAM creds JSON
- Responds on `/latest/meta-data/` with a generic listing

The KYC URL-import allowlist (V-40 plant location) MUST accept
hostnames `metadata.bvbe.internal` (or trick into accepting via
DNS rebinding). The Phase-2 V-40 plant should already have a
bypass — verify the bypass reaches `metadata.bvbe.internal`.

Plus a `mock-s3` service responding on `/kyc-bucket/` with a
listing of synthetic KYC document filenames. CHAIN D ends here.

**Architect adds the mock-imds + mock-s3 as part of Phase 9's
exit criteria.** Without them, CHAIN D is documentation-only.

## Architect resolutions for the open questions

1. **CHAIN B mass-assignment**: V-22 verified exploitable for
   admin promotion. Use it. No new plant.
2. **V-15 dep**: xml2js@0.4.23, confirmed.
3. **V-49 scope**: documentation-only, confirmed.
4. **CHAIN B persistence**: plant a second admin user via the
   newly-promoted attacker. Skip the changelog-disable step.
5. **`.env.bak` secret value**:
   `devsecret-do-not-use-in-prod-bvbe-2026`, AND hardcode the
   same value into `docker-compose.yml`'s JWT_SECRET so the
   discovered secret actually verifies.
6. **Two commits**: yes.

## Conditions for Gate 2 entry

1. ✅ V-15 plant: xml2js@0.4.23 pinned as direct dep of
   @bvbe/web. Sanctions importer at
   `/api/v2/admin/compliance/sanctions-import` (POST,
   `requireAdmin`).
2. ✅ V-48 plant: two commits (`add .env.bak` then `rm
   .env.bak`); `docker-compose.yml` hardcodes the same
   JWT_SECRET; trainees who find the secret in git history can
   forge a JWT that verifies.
3. ✅ V-49 plant: `optionalDependencies` reference + stub +
   missing `.npmrc`.
4. ✅ V-50 plant: nginx CL/TE-tolerant directives in
   `/etc/nginx/nginx.conf` location block.
5. ✅ mock-imds + mock-s3 services added to docker-compose.
6. ✅ All 4 killer chains have step-by-step PoCs documented in
   `docs/phases/phase-9/adversarial-qa.md`.
7. ✅ CHANGELOG.md gains the Phase 9 entry with 5 diegetic
   hints.
8. ✅ Phase 8 L7 housekeeping (5 items) all closed.
9. ✅ VULNS.md reaches 37 entries (33 + V-15, V-48, V-49, V-50).
10. ✅ `pnpm audit` reports the V-15 CVE.
11. ✅ `pnpm test` continues to pass (≥ 102).
12. ✅ `docker-compose down -v && docker-compose up` brings up
    green.

## Surfaces unchanged

Phase 9 doesn't touch:

- The Phase 1-7 planted vulnerabilities (V-1 through V-47 except
  the 4 new V-NNNs above)
- Any user-facing UI beyond CHANGELOG and the navbar housekeeping
- Any test that pins a planted vuln

## Test discipline

- The mock-imds and mock-s3 services don't need unit tests; their
  presence in docker-compose is the deliverable.
- The xml2js sanctions importer test covers happy-path benign XML
  only.
- A CL/TE unit test that "demonstrates upstream preference for
  Transfer-Encoding" is acceptable but should be framed as
  protocol-conformance, not as a smuggling primitive.

## Gate 2 entry: GO

Build-author may proceed.

— Architect
