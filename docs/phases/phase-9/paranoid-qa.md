# Phase 9 — Paranoid QA (Gate 4, FINAL)

**Reviewer:** Paranoid QA / compliance
**Date:** 2026-05-28
**Scope:** Phase 9 plants (V-15, V-48, V-49, V-50, V-51) + final lab-safety sweep
**Verdict:** **PASS** — lab is ship-ready.

## Methodology

- Read `CLAUDE.md`, `VULNS.md`, the Phase 9 plan, architect review, and the
  full Adversarial QA report (including the Gate-3 RETURN-TO-STAFF verdict
  and the V-51 fix-up addendum that closed CHAIN B).
- Audited the new Phase 9 surfaces for lab-safety violations only
  (real PII, real secrets, mainnet code paths, outbound third-party
  egress). Planted vulnerabilities are out of scope per CLAUDE.md.
- Cross-checked `VULNS.md` ledger against the codebase for every Phase 9
  V-NNN. Spot-checked V-NNN map across earlier phases.
- Verified DO NOT DEPLOY banner inheritance via `apps/web/app/layout.tsx`.
- Confirmed docker-compose service inventory + network isolation.

## Lab-safety checks

### PII in seed data + new fixtures — PASS

- `apps/mock-imds/src/server.ts:13-21` returns the AWS-documentation
  placeholder credentials (`AKIAIOSFODNN7EXAMPLE` /
  `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`). These are the canonical
  AWS-docs synthetic keys, not real credentials. Session token literal
  `FQoGZXIvYXdzELABVBE-LAB-FAKE-SESSION-TOKEN` is explicitly tagged "LAB-FAKE".
- `apps/mock-s3/src/server.ts:13-36` returns synthetic KYC keys
  (`kyc/user-001/passport-front.pdf`, etc.) and a `SYNTHETIC_DOC`
  whose `legalName` is `"Synthetic Subject (LAB)"` and whose
  documentNumber is `"LAB-SYNTH-0000-0001"`. Explicit "no real PII"
  comment at the top of the file.
- `apps/web/lib/compliance/sanctions-import.ts` does not ship any
  fixture XML. The test (`sanctions-import.test.ts`) is happy-path
  benign-XML only.

No real PII reachable from Phase 9 surfaces.

### Mainnet code paths — PASS

Grep across `apps/mock-imds`, `apps/mock-s3`, `apps/web/lib/compliance`,
and `apps/web/lib/observability.ts` for `mainnet|xpub|xprv|mempool.space|
blockstream|blockchain.info` returns zero hits. Phase 9 adds no
Bitcoin-network code path of any kind; the supply-chain plants live
in xml2js / git history / npm metadata / nginx config.

### Outbound third-party calls — PASS

- Grep for `fetch(|axios|got(|http.get|https.get|node-fetch` across all
  five new Phase 9 source files (mock-imds server, mock-s3 server,
  sanctions-import lib, sanctions-import route, observability.ts)
  returns **zero** hits. The mocks only `app.get(...)`-respond; they
  initiate no outbound traffic.
- `xml2js` entity-resolution: xml2js@0.4.23 uses the `sax-js` SAX parser
  internally, which does **not** perform external DTD or external entity
  resolution by default. The CVE-2023-0842 surface is prototype
  pollution via XML element names, not XXE. No internet egress on
  parser invocation.
- `apps/web/lib/observability.ts:16` does a dynamic
  `import("@bvbe-internal/observability")` — the package is absent
  from the public registry, the catch swallows the error, no network
  call resolves successfully. The dep-confusion vector (V-49) is the
  intended documentation-only plant.
- docker-compose networks: `mock-imds` lives on a carved
  `169.254.169.0/24` (`bvbe-imds-net`) reachable only by `web`;
  `mock-s3` joins `bvbe-net` only. Neither service publishes host
  ports. No path from either mock to the public internet.

### Committed secrets (V-48 verification) — PASS

- V-48 `.env.bak` JWT_SECRET value matches lab placeholder pattern: ✅
  `git log --all -p -- .env.bak` shows
  `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026` in commit
  `193426c` and the deletion in `e96ffd8`. The secret string literally
  reads "devsecret-do-not-use-in-prod" — unambiguously a lab artifact,
  no chance of mistaking it for a real Blaze production key.
- docker-compose.yml JWT_SECRET matches V-48 value: ✅
  `docker-compose.yml:30` (`web`) and `:97` (`ws-gateway`) both hardcode
  `JWT_SECRET: devsecret-do-not-use-in-prod-bvbe-2026`. The discovered
  key actually verifies against the running stack.
- No accidental REAL production secrets: ✅
  - `.env.bak` ancillary content: `JWT_SECRET_LEGACY=changeme` (the
    V-9 weak-default plant, intentional), `DATABASE_URL` with
    `bvbe-prod-pw-2024` (cosmetic ops-realism fluff, not a real DB
    password — db service uses literal `bvbe`/`bvbe` per
    docker-compose.yml:190-191). All fake.
  - `git diff HEAD~5 HEAD -- apps/ docker-compose.yml nginx/` scan
    surfaced no real production credentials.
- mock-s3 AWS keys are synthetic: ✅
  `AKIAIOSFODNN7EXAMPLE` is the well-known AWS-documentation
  placeholder used in AWS's own published examples. The matching
  secret `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` is also the AWS
  docs placeholder. Both are explicitly NOT real keys; AWS itself
  publishes them in tutorials.
- `.env.example` still placeholder-only: ✅
  `JWT_SECRET=replace-me-with-a-32-byte-random-secret`,
  `CTF_SALT=change-me-per-cohort`. No real secrets introduced.

### DO NOT DEPLOY banners — PASS

`apps/web/app/layout.tsx` mounts `<DoNotDeployBanner variant="top" />`
and `<DoNotDeployBanner variant="footer" />` at the root layout level.
Every page in the App Router — including the new
`/admin/compliance/sanctions-import` UI and every changelog entry —
inherits the banner without per-page opt-in. Verified entry points:

- `README.md:3-7` — banner at top.
- Landing page (`apps/web/app/page.tsx:26`) — inherits layout +
  inline "BVBE is a deliberately vulnerable training exchange" copy.
- Login page — inherits root layout.
- All `/admin/*` and `/support/*` pages — inherit root layout.
- mock-imds and mock-s3 — no UI surface, banner not applicable.

### Lab self-containment — PASS

docker-compose services: `nginx`, `web`, `db-migrate`, `ws-gateway`,
`worker`, `bitcoin-mock`, `mock-imds`, `mock-s3`, `db`, `redis` — ten
services, all internally networked. Host-port bindings: only
`nginx:80→80` (the documented entry point). No `network_mode: host`,
no other host-port publishing. Named volumes: `bvbe-db`, `bvbe-uploads`
— both declared in the top-level `volumes:` block, both destroyed by
`docker-compose down -v`. The bvbe-imds-net `169.254.169.0/24` is
explicitly carved and only `web` + `mock-imds` join it; no host
network manipulation needed. mock-imds and mock-s3 add no new volumes.
`docker-compose down -v` destroys everything cleanly.

## VULNS.md ledger sync (Phase 9 plants)

| V-NNN | Code matches description? | Location accurate? |
|-------|---------------------------|--------------------|
| V-15  | ✅ | `apps/web/package.json:28` pins `xml2js@0.4.23`; `apps/web/lib/compliance/sanctions-import.ts:17` calls `parseString` with default options; route at `apps/web/app/api/v2/admin/compliance/sanctions-import/route.ts` is `requireAdmin`-gated. |
| V-48  | ✅ | Commits `193426c` (add) and `e96ffd8` (delete); HEAD does not contain `.env.bak`; secret value matches `docker-compose.yml:30,97`. |
| V-49  | ✅ | `apps/web/package.json:31-33` `optionalDependencies`; `apps/web/lib/observability.ts:14-21` lazy `import()`; no `.npmrc` at any depth in the repo tree. |
| V-50  | ✅ | `nginx/nginx.conf:69-71` (CL/TE-tolerant directives in `location /`) + `docker-compose.yml:36` (`NODE_OPTIONS: "--insecure-http-parser"`). Both halves OPS-2024-117-commented. |
| V-51  | ✅ | `apps/web/app/api/v2/me/route.ts:52-84` defines the PATCH handler; `patchSchema` accepts `role: z.string().optional()` (no enum); `parsed.data` is forwarded verbatim to `prisma.user.update`. |

## VULNS.md ledger sync (full lab, 40 plants)

- Total V-NNN count in VULNS.md: **40** (`grep -c "^### V-"` returns
  41; subtracting the template-format header line yields **40** body
  entries). Matches the Phase 9 fix-up addendum claim of 40.
- The Gate-1 exit criterion said "37" (33 prior + V-15/48/49/50);
  the Gate-3 RETURN-TO-STAFF noted +2 numbering-drift from earlier
  phases, and the V-51 fix-up added one more. **Reconciled: 40 is
  correct.** The "37" target was based on an undercount of prior
  phases — not a missing plant.
- CHAIN A/B/C/D summary block accurate: ✅
  `VULNS.md:520-523` correctly enumerates V-48+V-19+V-6+V-33 for
  CHAIN A, V-50+V-51 for CHAIN B, V-25 for CHAIN C, and V-48+V-6 /
  V-40 for CHAIN D's two paths. V-22 is correctly described as
  NOT part of CHAIN B (the Gate-3 correction landed).

## All 4 killer chains — final verdict

- CHAIN A (drain hot wallet): **PASS** — V-48 → V-19 → V-6 → V-33,
  zero-knowledge attacker walk documented in adversarial-qa.md.
- CHAIN B (admin persistence): **PASS** — V-50 (both halves) → V-51,
  closed by the Phase 9 fix-up addendum. Independent verifier
  RETURN-TO-STAFF blocker resolved.
- CHAIN C (mass liquidation): **PASS** — already complete from
  Phase 5; re-verified against the fresh stack.
- CHAIN D (DB+KYC exfil, both paths): **PASS** —
  Path 1 (V-48 + V-6 → `/api/v1/internal/users`) and
  Path 2 (V-40 SSRF → mock-imds → mock-s3) both exploitable.

## Final lab-readiness sweep

- README banner: ✅ (`README.md:3-7`)
- Landing page footer banner: ✅ (root layout `<DoNotDeployBanner variant="footer" />`)
- Login page banner: ✅ (inherits root layout)
- Admin/support page banner inheritance: ✅ (App Router root layout)
- `pnpm audit` reports V-15 CVE: ✅ (per Gate 3 verification —
  `GHSA-776f-qx25-q3cc, xml2js < 0.5.0`)
- `pnpm test` ≥ 104: ✅ (per Gate 3: `28 files / 104 tests passed`)
- `pnpm next build` succeeds: ✅ (per Gate 3 staff-eng pass; not
  re-run in Gate 4 — accepted on Gate 3's load-bearing signal)
- `docker-compose down -v` destroys everything: ✅ (only `bvbe-db`
  and `bvbe-uploads` named volumes; no bind-mounted state)

## Verdict

**PASS** for final commit. The lab is shippable.

All four killer chains are exploitable end-to-end against a
zero-knowledge attacker on a fresh `docker-compose up -d` stack.
The five Phase 9 plants (V-15, V-48, V-49, V-50, V-51) are all
correctly located and ledgered. No real PII, no mainnet path, no
outbound third-party egress, no accidental real-production secrets.
The DO NOT DEPLOY banner is inherited across every developer-facing
surface via the root layout. The lab self-destructs cleanly on
`docker-compose down -v`.

## Forward note

Three items for instructor materials (none are blockers):

1. **VULNS.md plant count discrepancy with Gate-1.** The architect's
   Phase 9 review specified a target of 37 plants; the shipped lab
   has 40. The delta is +1 for V-51 (architect-blessed Phase 9
   fix-up) and +2 for prior-phase numbering drift the Gate-3
   verifier flagged. Instructors running CTF cohorts should reference
   the 40-entry ledger as ground truth, not the Gate-1 architect
   note.

2. **V-48 git-history secret is a single-clone artifact.** Trainees
   working from a re-packaged repo (zip download from a CTF portal)
   that excludes `.git/` will not see the V-48 leak and will fail
   to walk CHAIN A or CHAIN D fast-path. Lab distribution must
   include the full git history; document this in the instructor
   handbook.

3. **mock-imds 169.254.169.254 routing depends on Docker version.**
   The `bvbe-imds-net` ipv4_address pin to `169.254.169.254` works on
   Docker 24+ with default bridge driver behavior; older Docker
   versions may reject link-local pin attempts. If a trainee can't
   resolve the IP literal, the network alias `metadata.bvbe.internal`
   is the fallback target.

— Paranoid QA
