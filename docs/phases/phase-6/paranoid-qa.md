# Phase 6 — Paranoid QA (Gate 4)

**Reviewer:** Paranoid QA / compliance
**Date:** 2026-05-28
**Scope:** Phase 6 — lending, staking, OTC desk, P2P
**Verdict:** PASS

## Methodology

Read `CLAUDE.md` (no-fix rule), `VULNS.md` V-44/V-45/V-46 entries, the Phase 6
plan, architect review, and adversarial QA verdict. Then:

- Inspected the Phase 6 migration SQL for any seed user/PII data.
- Grepped Phase 6 surface (`apps/web/lib/{lending,staking,otc,p2p}`,
  `apps/web/app/{lending,staking,otc,p2p}`, `apps/web/app/api/v2/me/{lending,
  staking,otc,p2p}`, `apps/worker/src/yield-accrual.ts`,
  `apps/worker/src/staking-rewards.ts`, `packages/shared/src/yield.ts`,
  `nginx/nginx.conf`) for `fetch(`, `axios`, `mainnet`, `xpub`, `xprv`,
  `mempool.space`, `blockstream`, `blockchain.info`, `password`, `secret`,
  `api[_-]?key`, `AKIA`, `BEGIN PRIVATE`.
- Walked the V-44/V-45/V-46 call sites and matched them line-by-line against
  the VULNS.md ledger locations.
- Verified the root `app/layout.tsx` (which carries the DO NOT DEPLOY banner)
  is the only layout in the app tree — no nested layouts under `lending/`,
  `staking/`, `otc/`, or `p2p/`.
- Verified `.env.example` and `docker-compose.yml` are unchanged at this
  commit (`git diff HEAD --stat` returned empty for those paths).

## Lab-safety checks

### PII in seed data

**CLEAN.** The Phase 6 migration
(`packages/db/prisma/migrations/20260615000000_phase_6_yield_otc_p2p/migration.sql`)
seeds only:

- 3 `lending_pools` rows: `pool_btc / BTC`, `pool_usdt / USDT`, `pool_eth / ETH`
  with `apyBaseBps=200`, `apySlopeBps=1000`.
- 2 `staking_programs` rows: `stk_eth / ETH / ETH / 400 / 3600`,
  `stk_ltc / LTC / LTC / 300 / 3600`.

No users, emails, phone numbers, IBANs, addresses, names, or any
identifier that could correspond to a real person. Asset symbols and
integer bps only.

### Mainnet code paths

**CLEAN.** Grep of all Phase 6 new code for `mainnet|xpub|xprv|mempool.space|
blockstream|blockchain.info`: zero matches. Lending/staking/OTC/P2P do not
touch the BTC RPC at all — they move `Balance` rows. No new wallet code, no
new chain-fetch path. The mock-node integration remains where Phase 3
planted it (`apps/worker/src/index.ts` deposit-watcher hitting
`MOCK_BTC_URL`); Phase 6 added nothing chain-adjacent.

### Outbound third-party calls

**CLEAN.** All `fetch(` calls in Phase 6 new code:

| File | Line | URL |
|---|---|---|
| `apps/web/app/lending/page.tsx` | 33 | `/api/v2/public/lending/pools` (same-origin) |
| `apps/web/app/staking/page.tsx` | 26 | `/api/v2/public/staking/programs` (same-origin) |
| `apps/web/app/p2p/page.tsx` | 29 | `/api/v2/public/p2p/offers` (same-origin) |

All three are browser-side relative-path calls back to the Bitvulnex app. No
worker-side or server-side `fetch` in Phase 6 code. No outbound third-party
URL anywhere.

### Committed secrets

**CLEAN.** Case-insensitive grep for `password|secret|api[_-]?key|AKIA|
BEGIN PRIVATE` across all Phase 6 lib + worker files produced one hit
(`apps/web/lib/lending/withdraw.ts:16` — the function name
`withdrawSupply` substring-matches `apikey`, false positive). No hardcoded
passwords, JWT secrets, database URLs, AWS keys, or PEM bytes. Phase 6
doesn't plant any secret-shaped vulns (V-44/45/46 are an off-by-one, a
race, and a header trust violation), so the expected count of new
committed secrets is exactly zero, which is what the code has.

`.env.example` and `docker-compose.yml` are unmodified by this phase.

### DO NOT DEPLOY banners

**PRESENT.** The four new pages — `/lending`, `/staking`, `/otc`, `/p2p`
— each consist of a single `page.tsx` under `apps/web/app/<dir>/` with
no sibling `layout.tsx`. The root `apps/web/app/layout.tsx:26` renders
`<DoNotDeployBanner variant="top" />` and `<DoNotDeployBanner variant=
"footer" />` (line 30) around `<main>`. All four pages therefore inherit
the top and footer DO NOT DEPLOY banners. No banner-bypass layout in the
phase.

### Lab self-containment

**INTACT.** Phase 6 introduces no new docker services — the lending and
staking workers are BullMQ jobs registered in the existing `worker`
process (`apps/worker/src/index.ts` already runs alongside
deposit-watcher and liquidation-watcher). `docker-compose.yml` is
unchanged. `docker-compose down -v` still tears down everything since no
new volumes were added either.

## VULNS.md ledger sync

| V-NNN | Code matches description? | Location accurate? |
|-------|---------------------------|--------------------|
| V-44  | YES                       | `apps/worker/src/yield-accrual.ts:50` — `db.lendingPosition.findMany({ where: { pool: pool.asset, side: "supply", status: "open" } })` runs after `interest` is computed (line 36) and after `pool.borrowed`/`pool.supplied` are read at the top of the loop. Distribution divides by current `pool.supplied` (line 56) including any post-`lastAccrual` supply rows. Matches the ledger's "supply position set read after interest computed" framing exactly. |
| V-45  | YES                       | `apps/web/lib/staking/claim.ts:32` — `findMany({ where: { positionId, claimedAt: null } })`; the `update` at line 41 is `where: { id: c.id }` with no `claimedAt: null` predicate, and the loop is not wrapped in `$transaction`. The balance upsert at line 48 runs after the loop, so two concurrent handlers credit the same rows twice. Matches ledger framing. |
| V-46  | YES                       | `apps/web/app/api/v2/me/otc/accept/route.ts:43-44` — `deskRole = req.headers.get("x-bvbe-desk-role")`, `feeBps = deskRole === "maker" ? MAKER_FEE_BPS : TAKER_FEE_BPS` (constants on lines 26-27, `MAKER_FEE_BPS = 0`). `nginx/nginx.conf:68-69` strips `x-bvbe-user-id` and `x-bvbe-internal-trace` but NOT `x-bvbe-desk-role`. Matches ledger framing on both code-side and nginx-side. |

No code-level vuln in Phase 6 surface is missing from VULNS.md. No ledger
entry V-44/V-45/V-46 is missing from code. Adversarial QA's PoCs land on
exactly these three plants and no others.

## Architect's surfaces-to-leave-clean

- `/api/v1/internal/*` — **CLEAN.** No `api/v1/internal` paths added.
- `lodash` `_.merge`/`_.mergeWith`/`_.set` — **CLEAN.** Grep across Phase 6
  new files returns zero lodash merge/set imports. (The architect allowed
  `lodash/sumBy` etc.; this phase reaches for plain `Decimal.add` and
  `Array.reduce` and doesn't import lodash at all.)
- `child_process` / `exec` / `spawn` — **CLEAN.** Zero matches.
- `$queryRawUnsafe` / template-literal SQL — **CLEAN.** Zero matches.
- nginx CL/TE-tolerant directives — **UNCHANGED.** `nginx/nginx.conf`
  comment at line 33 still flags Phase 9 as the activation point.
- New SSRF surfaces — **CLEAN.** No code in Phase 6 takes a user-supplied
  URL and fetches it. P2P `payMethod` is stored free-text only; OTC
  endpoints take typed enums + decimals, no URL fields; lending/staking
  endpoints take asset symbols + amounts.

## Adversarial QA cross-check

Gate 3 verdict was PASS. The "carryover observations" section (V-27 reach
into new tier gates, last-trade oracle reuse for lending borrow LTV,
OTC accept double-fill race, `/api/v2/public/lending/pools` candidate
for Phase 8 CHAIN D extension, `Math.sqrt` Number cast in `quote.ts`)
are all either (a) extensions of existing planted vulns, (b) explicit
Phase 7/8 deferrals, or (c) accepted shape. None of them are lab-safety
concerns — none of them ship a real secret, a mainnet path, real PII, or
a banner regression. No conflict with a Gate 4 PASS.

## Verdict

**PASS.** Phase 6 introduces no real PII, no mainnet code path, no
outbound third-party network call, no committed secrets, no banner
regression, and no break in lab self-containment. V-44/V-45/V-46 are
present in the code at the exact lines the ledger records. The
architect's clean surfaces are clean.

Phase 6 is cleared for commit.

— Paranoid QA
