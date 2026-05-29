# Phase 10 (Revamp) — Paranoid QA (Gate 4, FINAL)

> **Reviewer:** Paranoid QA / compliance
> **Date:** 2026-05-29
> **Scope:** Phase 10-revamp's full additive surface (189 files in
> `ffc3808~1..af66a32`) audited for lab-safety violations only.
> **Verdict:** **PASS** — phase 10-revamp introduces no lab-safety
> regressions. Lab remains ship-ready.

## Methodology

- Read `CLAUDE.md`, `VULNS.md`, the phase 10 plan, the companion
  architect review and adversarial QA in this directory.
- Audited the new phase-10 surfaces (new pages, new components,
  new lib helpers, new worker, new shared module, new
  migrations, new dockerfile changes) for lab-safety violations
  only. Planted vulnerabilities are out of scope per CLAUDE.md
  Gate 4 guidance.
- Spot-checked banner inheritance via the root layout, the
  do-not-deploy banner component, the README, and the login page.
- Grepped the full phase-10 footprint for real-PII shapes
  (real-domain emails, SSN, IBAN), real-secret shapes (AWS keys,
  Stripe live keys, JWT-shaped strings), mainnet-Bitcoin code paths
  (`mainnet`, `xpub`, `xprv`, public-API hostnames), and outbound
  third-party hostnames.

## Lab-safety checks

### Real PII in new seed / fixture / page content — PASS

Phase 10 added one seed extension (`seedMarketMakerBalances()` in
`packages/db/prisma/seed.ts`) that funds two synthetic accounts
`mm.alpha` / `mm.beta`. Grep across `packages/db/prisma/seed.ts`
for real-PII shapes:

- Real-domain emails (`@gmail.com`, `@yahoo.com`, `@hotmail.com`,
  `@outlook.com`, `@protonmail.com`): zero hits.
- SSN-shape (`NNN-NN-NNNN`): zero hits.
- IBAN-shape (`CCNNAAAAAAAAAAAAAAA`): zero hits.

The phase-10 new screenshot set (16 PNGs under
`docs/phases/phase-10-revamp/screenshots/`) was scanned manually
during slice-by-slice L7 reviews; all subject names rendered are
synthetic lab users (e.g. `alice`, `bob`, `mallory`, the
mock-market-maker accounts).

The slice-7 themed error route (`apps/web/app/error.tsx`)
surfaces `error.message` + `error.digest` to the user. This was
flagged as **N-1** in the slice-7 L7 review and is acceptable for
a deliberately vulnerable training lab — but the architect
explicitly noted in the closeout that the lab's `error.tsx` should
NOT be lifted unchanged into any real product fork.

### Real secrets in new code — PASS

Grep across all new phase-10 source files (`apps/web/lib/portfolio`,
`apps/web/lib/trade`, `packages/shared/src/equity.ts`,
`apps/worker/src/equity-snapshot.ts`, every new
`apps/web/components/exchange/**`) for:

- AWS access-key shape (`AKIA[0-9A-Z]{16}`): zero hits.
- Stripe live keys (`sk_live_`, `pk_live_`): zero hits.
- Hardcoded long secret literals: zero hits.

`.env.example` at HEAD is unchanged from pre-phase-10 (phase 10
did not extend it). The strict-placeholder defaults remain:

```
JWT_SECRET=replace-me-with-a-32-byte-random-secret
DATABASE_URL=postgresql://bvbe:bvbe@db:5432/bvbe?schema=public
```

Phase 10 did not introduce any new env var. The pre-existing
planted-weak-default values (`.env.bak` git history,
`JWT_SECRET_LEGACY=changeme`, `docker-compose.yml`'s
`devsecret-do-not-use-in-prod-bvbe-2026`) are unchanged and
remain accounted for in `VULNS.md` as V-9 and V-48.

### Mainnet Bitcoin code paths — PASS

Grep across all phase-10 new code for:

- `mainnet`: zero hits.
- `xpub` / `xprv`: zero hits.
- `mempool.space`, `blockstream.info`, `blockchain.info`: zero hits.

Phase 10 ships no new Bitcoin-network code path of any kind. The
mock `bitcoin-mock` service in docker-compose continues to be the
sole Bitcoin counterparty and is regtest-flavored only. The new
phase-10 surfaces (markets, earn, portfolio, trade) consume
in-process synthetic market data from the new market-maker
worker — never a live exchange API.

### Outbound third-party calls — PASS

Grep across all new phase-10 code for `https?://` URLs not pointing
at `localhost`, `127.0.0.1`, `metadata.bvbe.internal`, or
`mock-*`: zero hits.

The new ticker/markets/chart endpoints serve data computed in
process from seeded `Pair` and `MarketMaker` rows. The
equity-snapshot worker reads only the local Postgres. The
portfolio activity helper computes purely from local DB queries.
No fetch goes off-box.

### docker-compose self-containment — PASS (carried forward)

Phase 10's docker-compose changes (slice 0 + slice 2) were purely
additive: a new `worker` market-maker process and the seed of new
`Pair` / `MarketMaker` / `EquitySnapshot` tables via Prisma
migration. No new external image, no new network egress, no new
volume mount that escapes the project directory. `docker compose
up -d` brings up 9/9 services green; the holistic L7 review on
2026-05-28 verified `docker compose down -v && docker compose up`
produces a clean stack — phase 10 does not alter that property.

### DO NOT DEPLOY banner discipline — PASS

- `apps/web/app/layout.tsx:29, 36` mounts `<DoNotDeployBanner
  variant="top" />` and `<DoNotDeployBanner variant="footer" />`,
  so every page rendered under the root layout inherits both
  banners.
- `apps/web/components/banner/do-not-deploy.tsx:20` carries the
  copy "DO NOT DEPLOY — Blaze Vulnerable Bitcoin Exchange is an…"
- `README.md` carries the lab-warning banner at the top
  (pre-existing, unchanged).
- The new `apps/web/app/not-found.tsx` and `apps/web/app/error.tsx`
  render inside the root layout (Next.js App Router behavior), so
  they inherit the banner — verified via HTTP smoke at
  `/not-a-page` (markup contains both banner instances).
- The phase-10 dark-design system migration deliberately kept the
  banner unchanged; it remains visually loud and high-contrast.

No new page or layout was introduced that bypasses the root
layout. The signup page, login page, trade page, markets page,
earn page, portfolio page, wallet pages, account pages, admin
pages — all render under the root layout.

### VULNS.md ledger drift — PASS

`grep -cE "^### V-[0-9]+" VULNS.md` → **40**. `sort -u` confirms
no duplicate headings. Plan exit criterion #6 ("All 40 planted
V-NNN") matches reality. No phase-10 commit altered `VULNS.md`
(zero adds, zero edits, zero deletes against the file).

Cross-checked: every V-NNN's `Location:` line in `VULNS.md` still
points to a file that exists at HEAD with the cited construct
intact (per adversarial-qa.md §"Per-vuln verification at HEAD").

## Surfaces phase 10 did not touch — safety-relevant

Phase 10 left untouched (verified empty-diff over
`ffc3808~1..af66a32`):

- `apps/web/middleware.ts` (the auth + role middleware).
- `apps/web/lib/{withdrawal,treasury,otc,staking,lending,engine,
  kyc-storage.ts,kyc-tier.ts}` (the planted-vuln modules).
- `packages/shared/src/{jwt,jwt-v1,markdown,btc-address,
  psbt-envelope,password,totp,yield}.ts`.
- `apps/mock-imds/` and `apps/mock-s3/` (the synthetic IMDS +
  S3 services from phase 9).
- `docker-compose.yml`'s `--insecure-http-parser` flag, the
  `mock-imds` / `mock-s3` service definitions, the JWT secret
  literal, and the host-network-isolation configuration.
- `nginx/nginx.conf` strip list and CL/TE directives (touched
  but the planted constructs unchanged at HEAD).
- `.env.example` (strict placeholders only).
- `.gitignore` content related to backup/env files (so the V-48
  `.env.bak` discoverability story is unchanged).
- `apps/web/keys/` (the lab's bundled key material for the
  planted-crypto chains).
- `packages/db/prisma/schema.prisma`'s `RefreshToken` model
  (planted no-`usedAt`/`revokedAt` shape preserved).

## Findings

### Lab-safety blockers
None.

### Lab-safety observations
None requiring action at phase close.

The slice-7 N-1 (`error.tsx` surfaces `error.message`) is
**lab-acceptable** — the architect explicitly accepted the
construct as appropriate for a deliberately-vulnerable training
environment, with a documented note for a hypothetical
real-product fork.

## Verdict

**PASS.** Phase 10-revamp introduces zero lab-safety regressions:
no real PII, no real secrets, no mainnet code paths, no
third-party outbound calls, no broken banner inheritance, no
ledger drift, no docker-compose escape, no untracked side-effects
beyond the project directory. The lab is ship-ready.

Phase 10-revamp's three closeout gates (architect, adversarial,
paranoid) all sign off. The phase can be marked complete.

— Paranoid QA
