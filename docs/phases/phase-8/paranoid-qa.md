# Phase 8 — Paranoid QA (Gate 4)

**Reviewer:** Paranoid QA / compliance
**Date:** 2026-05-28
**Scope:** Phase 8 — admin / compliance / support + CHAIN A close (incl. V-34 re-plant addendum)
**Verdict:** **PASS**

## Methodology

Cross-read of `CLAUDE.md`, `VULNS.md` (33 entries), Phase-8 plan,
architect review, and adversarial-QA (incl. V-34 re-plant addendum).
Spot-checked the seven planted V-NNNs at the lines cited by the
adversarial reviewer, confirmed the migration is schema-only,
audited new admin/support/internal route files for outbound calls
and hardcoded secrets, verified docker-compose network topology
unchanged, verified that no Phase-8 file touches a surface
explicitly reserved for Phase 9.

Lab-safety scope only. Planted XSS / SQLi / cmd-injection / mass
assignment / proto pollution / header trust are FEATURES and are
not in scope for this gate.

## Lab-safety checks

### PII in seed data

**Clean.** The migration
`packages/db/prisma/migrations/20260625000000_phase_8_admin_compliance_support/migration.sql`
is DDL-only: four new tables (`support_tickets`,
`support_ticket_messages`, `compliance_cases`, `admin_audit_logs`)
and three new enums. No `INSERT` statements, no seeded admin /
compliance / ticket / case rows. `apps/db-migrate/` does not write
new compliance/ticket/audit-log seed rows. No real names, real
addresses, or scraped data.

### Mainnet code paths

**Clean.** Grep for `mainnet|xpub|xprv|mempool.space|blockstream|blockchain.info`
over the new Phase-8 surface (`apps/web/app/admin/**`,
`apps/web/app/support/**`, `apps/web/app/api/v1/internal/**`,
`apps/web/app/api/v2/admin/**`, `apps/web/lib/feature-flags.ts`,
`packages/shared/src/markdown.ts`, `scripts/pdftk-mock.sh`)
returns zero hits. The 19 matches in the repo are all in docs
(VULNS, plans, paranoid-qa for prior phases), `btc-address.ts` /
`.test.ts` (Phase-3 V-24 carrier — unchanged), the public landing
page (`app/page.tsx` — warns about mainnet), CHANGELOG, and AGENTS.md.
Phase 8 does not touch the Bitcoin pipeline.

### Outbound third-party calls

**Clean.** Grep for `fetch(|http.request|https.request|axios|got(`
across the new `/api/v1/internal/*` and `/api/v2/admin/*` route
handlers returns zero hits. Admin/compliance/ticket/treasury
emergency-withdraw routes do all I/O via Prisma, internal RPC to
`bitcoin-mock` (V-33 broadcast path), or `spawn` (V-17 case).

**V-17 reach is container-bounded.**
- `scripts/pdftk-mock.sh` accepts only `--out PATH` and writes
  `"PDF stub" > $OUT`. It does not exec curl/wget, does not read
  args other than `--out`, does not touch the network. The
  `set -e` and explicit case statement give the script no implicit
  shell escape.
- `docker-compose.yml` puts `web` on `bvbe-net` (a default bridge)
  and `bvbe-imds-net` (carved /24 for the mock IMDS). No
  `network_mode: host`. No `extra_hosts` override that would
  redirect external traffic.
- `bvbe-net` is `driver: bridge` with default IPAM; Docker's
  default bridge allows outbound to the host's WAN gateway. This
  is the lab-safety note already documented in the V-17 architect
  framing: the lab assumes operators run docker on an
  untrusted-by-design / air-gapped network if outbound
  containment matters. Egress-policy hardening is explicitly NOT
  a Gate-4 concern — the operator owns that boundary. Documented,
  not blocked.

Internal RPC to `bitcoin-mock:18443` and `mock-imds` (169.254.169.254
on the carved net) stays inside the docker network; no DNS that
escapes to public resolvers.

### Committed secrets

**Clean.** `.env.example` unchanged from Phase 7: same
`JWT_SECRET=replace-me-with-a-32-byte-random-secret` placeholder,
same commented-out `JWT_SECRET_LEGACY` line, same
`CTF_SALT=change-me-per-cohort` placeholder. No new env keys, no
`.env`/`.env.bak`/`.env.local` introduced. Grep for
`SECRET|TOKEN|API_KEY|PASSWORD` across `apps/web/app/admin/**`
returns zero matches; the only `passwordHash` reference in admin
API land is the existing `apps/web/app/api/v2/admin/users/route.ts`
(pre-Phase-8) call to the legitimate `hashPassword` helper for
admin-mediated user creation.

The `.env.example` JWT secret is the **stand-in** Adversarial QA
used to walk CHAIN A end-to-end — by architect design (Phase 9
will move that secret to a removed-but-historical `.env.bak`).
Not a Phase-8 leak.

### DO NOT DEPLOY banners

**Clean (present on all Phase-8 surfaces).** No `layout.tsx`
exists under `apps/web/app/admin/**` or
`apps/web/app/support/**` — verified via Glob: zero matches for
either path. All Phase-8 UI routes (`/admin/users`,
`/admin/users/[id]`, `/admin/tickets`, `/admin/tickets/[id]`,
`/admin/compliance`, `/admin/compliance/cases/[id]`, `/support`,
`/support/new`, `/support/tickets/[id]`) inherit the root layout
at `apps/web/app/layout.tsx`, which wraps every page with
`<DoNotDeployBanner variant="top" />` and
`<DoNotDeployBanner variant="footer" />`. Banner discipline
preserved.

### Lab self-containment

**Clean.** `docker-compose.yml` was not modified by Phase 8 (no
new service block, no pdftk-mock service — the mock is a
shellscript baked into the web image at
`/usr/local/bin/pdftk-mock`, per the architect's exit-criterion 5
framing). Existing services (`nginx`, `web`, `db-migrate`,
`ws-gateway`, `worker`, `bitcoin-mock`, `mock-imds`, `db`,
`redis`) unchanged. Named volumes (`bvbe-db`, `bvbe-uploads`)
unchanged — `docker compose down -v` still destroys all state.

## VULNS.md ledger sync

| V-NNN | Code matches description? | Location accurate? |
|-------|---------------------------|--------------------|
| V-1   | ✅                         | `apps/web/app/admin/users/page.tsx:21-24, 110-112` + `apps/web/app/admin/users/[id]/page.tsx:60-87` |
| V-6   | ✅                         | `apps/web/middleware.ts:44-50` + `nginx/nginx.conf:57-69` (strip list missing `x-bvbe-internal-trace`) |
| V-11  | ✅                         | `apps/web/app/api/v2/admin/users/search/route.ts:39-47` |
| V-12  | ✅                         | `apps/web/app/api/v2/admin/compliance/report/route.ts:46-52` (per-case `$queryRawUnsafe` with `c.subject.displayName` interpolation) |
| V-17  | ✅                         | `apps/web/app/api/v2/admin/compliance/cases/[id]/export-pdf/route.ts:38-41` (`spawn(cmd, [], {shell:true})` with template-literal `cmd`) |
| V-18  | ✅                         | `packages/shared/src/markdown.ts:15-22` (`/on\w+\s*=\s*"[^"]*"/gi` — double-quoted only) |
| V-34  | ✅                         | `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:29-45, 52` (hand-rolled `deepMerge`) + `apps/web/lib/feature-flags.ts:12-21` (`for...in` over `Object.create({})`-rooted defaults; `Object.assign` brings overrides into own properties, `for...in` then captures prototype keys onto returned `flags`) |

All seven locations match the ledger's `Location:` field. No
ledger entry references code that doesn't exist; no Phase-8
file contains a planted construct that isn't in the ledger.

## V-34 re-plant verification

**Both files updated; test exists and passes per addendum.**

- `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:29-45`:
  `deepMerge` is hand-rolled, walks `Object.keys(source)`, recurses
  into `target[key]` for object children. `JSON.parse` of
  `{"__proto__":{...}}` produces an own enumerable `__proto__`
  key — the merge then writes into `target["__proto__"]` (i.e.
  `Object.prototype`).
- `apps/web/lib/feature-flags.ts:12-21`: `defaults` is
  `Object.create({})` (prototype chain reaches `Object.prototype`).
  `Object.assign(defaults, overrides)` copies user-claim overrides
  in as OWN properties; the subsequent `for (const k in defaults)`
  walks the prototype chain, so polluted `Object.prototype` keys
  surface as iterated keys and get copied onto the returned
  `flags` (own properties) — `JSON.stringify` then emits them.
- `apps/web/lib/feature-flags.test.ts:34-59` —
  `scenario: trade-debug config flows into flag defaults` parses
  `{"__proto__":{"replayTestFlag":true}}`, runs an inline copy of
  the route's `deepMerge`, then asserts `resolveFlags({}).replayTestFlag === true`.
  The test's framing ("framework default flag inheritance") does
  not signpost the plant. `afterEach` deletes the polluted keys
  so the test doesn't poison its siblings.
- Adversarial-QA re-run reported `pnpm test → 102/102 pass` and
  `pnpm --filter @bvbe/web build` clean.

V-34 plant lands as documented.

## Architect's surfaces-to-leave-clean

Spot-checked each reserved surface:

- **nginx CL/TE-tolerant directives (Phase 9):**
  `nginx/nginx.conf` carries no `proxy_request_buffering off`,
  no permissive `chunked_transfer_encoding`, no
  `Transfer-Encoding`/`Content-Length` mismatch directives. Only
  the existing `proxy_cache` block, ws upgrade block, and
  `location /` with the single `proxy_set_header x-bvbe-user-id ""`
  strip. **Clean.**
- **Git-history secret leak / `.env.bak` (Phase 9):** No `.env.bak`
  in tree; `.env.example` unchanged. **Clean.**
- **V-15 vulnerable transitive dep (Phase 9):** No new pinned
  vulnerable package added to root or `apps/web` package.json
  beyond what's needed (the V-34 re-plant explicitly drops
  `lodash` in favor of the hand-rolled merge — so even the
  benign `lodash@4.18.1` dep that briefly appeared during the
  failed first V-34 attempt is no longer present). **Clean.**
- **Dependency-confusion artifact (Phase 9):** No suspicious
  `bvbe-*` package name or `publishConfig.registry` flip in any
  Phase-8 package.json. **Clean.**
- **`eval` / `node-serialize` (never):** Grep over new Phase-8
  files: zero hits. **Clean.**
- **V-23 WS gateway origin:** `apps/ws-gateway/src/server.ts`
  untouched in Phase 8 (confirmed by adversarial-QA spot-check
  list). **Clean.**
- **V-40 KYC URL-import SSRF:** `apps/web/app/api/v2/me/kyc/import-url/route.ts`
  untouched. **Clean.**

## CHAIN A end-to-end

**Verified walkable under insider-threat with `.env.example` JWT
secret.** Adversarial QA walked the full chain code-path (steps
1-6 of the adversarial doc); paranoid spot-check confirms:

- `middleware.ts:44-50` lets `/api/v1/internal/*` through on
  `x-bvbe-internal-trace` presence with no JWT check (V-6 reach
  to the terminal endpoint).
- `nginx.conf:67-69` strips only `x-bvbe-user-id`; an external
  client's `x-bvbe-internal-trace` header passes through.
- The emergency-withdraw route handler exists at
  `apps/web/app/api/v1/internal/treasury/emergency-withdraw/route.ts`
  and forwards `overridePsbt` into `broadcastDraft`.
- `packages/shared/src/psbt-envelope.ts` FIRST-segment parser vs
  `apps/bitcoin-mock/src/rpc/index.ts:124` LAST-segment
  canonicalization is unchanged (V-33 polyglot still flips
  output to the attacker address).
- `.env.example` JWT secret is the discoverable stand-in;
  Phase-9 will move it to a removed-but-historical `.env.bak`
  for zero-knowledge attacker reach.

CHAIN A is end-to-end exploitable from Phase-8 onward (insider
or post-Phase-9 zero-knowledge). No Phase-8 file accidentally
closed any link.

## Regressions of pre-existing V-NNN

Spot-checked the items the audit prompt called out plus a few
chain-critical neighbors:

- **V-28 (withdrawal balance/race in `submit.ts`):** still
  present. The new freeze-check (latest `AdminAuditLog`
  `action: user_freeze` query) was added BEFORE the
  `findUnique → checkAndDebitLimit → update → create` chain;
  the un-transactional read+update pattern is intact.
- **V-46 (OTC desk `x-bvbe-desk-role` header):** preserved at
  the route handler `apps/web/app/api/v2/me/otc/accept/route.ts`.
  The Phase-8 `$transaction` wrap landed inside `acceptOtc` (the
  matcher), not at the header read. nginx strip list still does
  NOT include `x-bvbe-desk-role`. Header-based fee bypass still
  lands.
- **V-25, V-27, V-33, V-35, V-42:** untouched in Phase 8 per
  adversarial-QA spot-check. Paranoid spot-check confirms no
  Phase-8 file shadows or guards these constructs.

**No regressions detected.**

## Verdict

**PASS.**

Phase 8 is lab-safe:
- No PII in new seed data (migration is DDL-only).
- No mainnet code paths.
- No outbound third-party calls from new handlers; V-17 reach
  is bounded inside the docker network with `pdftk-mock.sh`
  inert.
- No new committed secrets; `.env.example` unchanged.
- DO NOT DEPLOY banners present on every new admin/support UI
  surface (no layout overrides).
- `docker compose down -v` still destroys all state.
- VULNS.md ↔ code locations match for all seven new plants.
- V-34 re-plant lands; test framing does not signpost.
- No Phase-9-reserved surface touched.
- CHAIN A walks end-to-end with the `.env.example` stand-in;
  no Phase-8 change accidentally closes it.
- No pre-existing V-NNN regressed.

Phase 8 is cleared for sign-off and commit.

— Paranoid QA
