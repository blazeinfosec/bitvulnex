# Phase 6 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-28
**Scope:** commit `01845b9` "phase 6: lending, staking, OTC desk, P2P escrow"
**Verdict:** PASS

## Methodology

Read `CLAUDE.md` (no-fix rule), `VULNS.md` (24 entries; V-44/45/46 new),
the Phase 6 plan, architect review, adversarial QA, paranoid QA.
Audited `git show 01845b9 --stat` (56 files, +5236/-57). Walked the
hot paths line by line:

- `apps/worker/src/yield-accrual.ts`, `apps/worker/src/staking-rewards.ts`,
  `apps/worker/src/index.ts`
- `apps/web/lib/{lending,staking,otc,p2p}/*.ts`
- `apps/web/app/api/v2/me/{lending,staking,otc,p2p}/**/*.ts`
- `apps/web/app/api/v2/me/margin/transfer/route.ts` (touched by Phase 6)
- `apps/web/lib/assets.ts` (Phase 5 F-1 closer)
- `nginx/nginx.conf` (diff against `2e67d4c`)
- `apps/web/middleware.ts` (V-35 intact check)
- `packages/db/prisma/schema.prisma`,
  `packages/db/prisma/migrations/20260615000000_phase_6_yield_otc_p2p/migration.sql`

Cross-referenced 21 pre-existing planted vulns (V-1 reserved; V-4, V-8…V-43)
against the Phase 6 diff. **Only one pre-existing surface was touched
(`apps/web/app/api/v2/me/margin/transfer/route.ts`) — additive
`requireKnownAsset()` call; does not interact with any V-NNN.**

Ran: `pnpm install`, `pnpm test`, four `tsc --noEmit` filters, `pnpm
--filter @bvbe/web build`. All green.

## Findings

### Blockers

None.

### Majors

None.

### Minors / Nits

**M-1. `staking-rewards.ts` has no DI seam in worker registration.**
`apps/worker/src/index.ts:119` calls `materializeStakingClaims()`
with no argument, whereas `accrueOnce()` is called the same way at
line 107 — both default to the live `prisma`. The DI seam exists in
both functions (`AccrualDb`, `RewardDb`) and the architect's
condition #2 only requires the seam exist, not that it be wired at
the worker. Tests use the seam directly. Fine as-is, flagged only
because the architect's condition framing could be read either way.

**M-2. `staking-rewards.ts` has no test file shipped.** Plan listed
`yield-accrual.test.ts` and others but did not require a
`staking-rewards.test.ts`. Architect review didn't require one
either. Both worker entry points share the same `perSecondRate`
math which IS covered by `packages/shared/src/yield.test.ts`. Future
phases that materialize unclaimed rows differently should add one.

**M-3. `quote.ts:24` uses `Math.sqrt(Number(amount.toString()))` — a
`Number` intermediate.** Adversarial QA already disclosed this in
Carryover #5 and Architect's "no Number intermediates" rule is
scoped to interest math per condition #3. Accepted, noted for the
record.

**M-4. `accept.ts` — concurrent ticket-accept race.** Adversarial QA
Carryover #2 already documented the `findUnique`-then-`update` race
on `OtcTicket` under default Prisma `ReadCommitted`. Two concurrent
accepts on the same ticket could both observe `status === "quoted"`
and proceed. Disclosed and accepted as realistic-code-shape; flagged
to architect as candidate Phase-7 expansion. Not a regression — and
not the V-46 plant (V-46 is the header bypass).

### Regressions of planted vulnerabilities

**None.** Spot-checked all 21 pre-existing entries:

| V-NNN | File | Touched by 01845b9? |
|---|---|---|
| V-4  | `apps/web/app/api/v2/me/orders/[id]/route.ts` | No |
| V-8  | `packages/shared/src/jwt-v1.ts` | No |
| V-9  | `apps/web/lib/env.ts`, `packages/shared/src/jwt-v1.ts` | No |
| V-10 | `apps/web/app/api/v2/auth/password-reset/request/route.ts` | No |
| V-13 | `apps/web/app/login/login-form.tsx` | No |
| V-14 | `apps/web/app/api/v2/me/kyc/doc/route.ts` | No |
| V-19 | `packages/shared/src/jwt-v1.ts`, `apps/web/app/api/.well-known/jwks.json/route.ts` | No |
| V-20 | `packages/shared/src/jwt-v1.ts` | No |
| V-21 | `apps/web/app/api/v2/auth/refresh/route.ts` | No |
| V-22 | `apps/web/app/account/orders/edit-order.ts` | No |
| V-23 | `apps/ws-gateway/src/server.ts` | No |
| V-24 | `packages/shared/src/btc-address.ts` | No |
| V-25 | `apps/web/lib/engine/match.ts` | No |
| V-27 | `apps/web/lib/kyc-tier.ts` | No (reaches into all 10 new Tier-gated routes — extension, not regression) |
| V-32 | `apps/web/app/api/v2/me/orders/[id]/route.ts`, `apps/web/lib/engine/place.ts` | No |
| V-35 | `apps/web/middleware.ts` | No — verified `x-middleware-subrequest` short-circuit intact at line 33 |
| V-40 | `apps/web/app/api/v2/me/kyc/import-url/route.ts` | No |
| V-41 | `apps/web/app/api/v2/me/kyc/documents/route.ts`, `apps/web/app/api/v2/admin/kyc/...` | No |
| V-42 | `apps/worker/src/deposit-watcher.ts` | No |
| V-43 | `apps/web/lib/engine/fees.ts` | No |

The only pre-existing surface touched is
`apps/web/app/api/v2/me/margin/transfer/route.ts` — a 7-line addition
of an `requireKnownAsset` call against the new `KNOWN_ASSETS` registry.
This closes Phase-5 F-1 nit (asset pinning) but does NOT interact
with V-25 (engine match), V-27 (tier compare — still hit in the
parent route), or V-42 (deposit watcher). All three planted vulns
remain reachable via their original entry points.

nginx config diff vs Phase 5 fix-up: additive only — the two new
`proxy_set_header x-bvbe-user-id ""` / `x-bvbe-internal-trace ""`
strip lines required for V-46's structural condition. Phase 9 CL/TE
block at `location /api/v2/public/` and the `proxy_cache_key`
omission untouched.

## Architect's Gate-2 conditions

1. ✅ Phase 5 F-1 closer — `apps/web/lib/assets.ts` exists with 6
   assets (BTC/USDT/USDC/ETH/LTC/DOGE); `requireKnownAsset` is
   called from lending supply/borrow, staking stake, p2p createOffer,
   and the margin/transfer route. Schema-layer registry, not
   TradingPair. ✓
2. ✅ Yield-accrual DI seam — `AccrualDb`, `RewardDb` types match
   the deposit-watcher pattern; `yield-accrual.test.ts` (4 scenarios)
   uses fake-DB shape.
3. ✅ `Prisma.Decimal` throughout interest math. `yield-accrual.ts`
   only escapes to `Number` once at line 33 for the `effectiveBps`
   integer-rounded compute — the per-position math stays in Decimal.
   `perSecondRate(bps)` in `packages/shared/src/yield.ts` is Decimal.
4. ✅ P2P ownership filters — `cancelOffer` filters
   `{id, userId, status:"open"}`; `markPaid` filters
   `{id, buyerUserId:userId, status:"pending_payment"}`; `release`
   filters `{id, sellerUserId:userId, status:"paid"}`. State machine
   gated by `WHERE status` predicates. No IDOR.
5. ✅ OTC fee bypass in accept handler, not matcher — `acceptOtc(args)`
   takes `feeBps: number` parameter; the handler computes `feeBps`
   from header and passes in. Matcher otherwise clean.
6. ✅ Lending pools seed — migration seeds 3 (BTC/USDT/ETH).
   Staking programs seed — 2 (ETH/LTC). Confirmed against
   `migration.sql`.
7. ✅ `Balance.amount` invariant — all 11 balance-touching call sites
   preserve `amount = available + locked`. Spot-checked:
   `supplyToPool`, `withdrawSupply`, `openBorrow`, `repayBorrow`,
   `stake`, `unstake`, `claimRewards`, `acceptOtc` (both sides),
   `createOffer`, `cancelOffer`, `createTrade`, `release`. Spot-leg
   decrements both `available`+`amount`; spot-leg unlocks reverse.
   Sell offers move into `locked` (no `amount` change). All correct.
8. ✅ Migration named `20260615000000_phase_6_yield_otc_p2p`. ✓
9. ✅ Tier gates — verified by reading route handlers:
   `lending/{supply,withdraw,borrow,repay}` = `requireTier(claims, 1)`,
   `staking/{stake,unstake,claim}` = `requireTier(claims, 1)`,
   `otc/{quote,accept}` = `requireTier(claims, 2)`,
   `p2p/{offers,trades,...}` = `requireTier(claims, 1)`.

## Surfaces explicitly left clean

- `/api/v1/internal/*` — clean. No new `api/v1/internal` paths.
- `lodash` `_.merge`/`_.set`/`_.mergeWith` — clean. Phase 6 imports
  no lodash.
- `child_process` / `exec` / `spawn` — clean.
- `$queryRawUnsafe` / template-literal SQL — clean.
- nginx CL/TE-tolerant directives — unchanged.
- New SSRF surface — clean. No URL-fetch in new code paths.

## Verification re-run

```
pnpm install                              -> "Already up to date"
pnpm test                                 -> 18 files, 74/74 pass
pnpm --filter @bvbe/shared exec tsc       -> clean
pnpm --filter @bvbe/worker exec tsc       -> clean
pnpm --filter @bvbe/web exec tsc          -> clean
pnpm --filter @bvbe/bitcoin-mock exec tsc -> clean
pnpm --filter @bvbe/web build             -> succeeded
                                            (24 dynamic routes registered;
                                             /lending /staking /otc /p2p
                                             prerendered as static)
```

All claims from the commit message reproduce.

## Realism check on the planted plants

- **V-44** (`apps/worker/src/yield-accrual.ts:50`). The supply
  position read happens AFTER the borrow-side interest is computed.
  No suspicious comment, no `// TODO race`, no dead branch. A
  reviewer auditing for "is this code clean" sees clean conservation
  math (credited + residual = interest). The flaw is in the
  *timing* of `findMany` vs the tick boundary — only an econ-attack
  mindset spots it. Plant is well-placed.
- **V-45** (`apps/web/lib/staking/claim.ts:32-44`). The `findMany`
  filter has `claimedAt: null` (looks like proper guarding), the
  per-row `update` doesn't repeat the predicate (looks like a
  natural "already filtered above" oversight). The loop is not
  wrapped in `$transaction` (looks like the author trusted that
  Prisma writes are atomic per-row, missing the read-write window).
  Realistic.
- **V-46** (`apps/web/app/api/v2/me/otc/accept/route.ts:43-44` +
  `nginx/nginx.conf:68-69`). The nginx strip-list strips two
  `x-bvbe-*` headers but not the new one — looks exactly like a
  forgotten add when the desk team requested a new internal header.
  The accept handler reads `req.headers.get("x-bvbe-desk-role")`
  with a comment plausibly explaining the internal-OTC-console
  pattern. Realistic.

## VULNS.md ledger format check

V-44, V-45, V-46 each carry: Category, Phase introduced, Location,
Exploitation path, Intended discovery difficulty, Realistic root
cause, Remediation, Chain membership. Format matches Phase 1-5
entries. Chain assignments are all "standalone" (architect's call;
none of V-44/45/46 contribute to CHAIN A/B/C/D).

## Forward note for Phase 7

Phase 7 lands withdrawal + treasury. Three observations the Phase 7
architect should weigh:

1. **OTC accept double-fill race** (Carryover #2 from Adversarial QA)
   sits in `apps/web/lib/otc/accept.ts`: two concurrent accepts of
   the same `ticketId` could both pass the `status === "quoted"`
   check before either commits the `update`. If Phase 7's withdrawal
   worker uses a similar `findUnique → check → update` shape under
   `ReadCommitted`, the architect should explicitly plant or
   explicitly close it — don't let the pattern leak unplanted.
2. **The `Balance.amount` invariant** survived Phase 6 because every
   new write path mirrored the spot-subtotal contract. Phase 7's
   withdrawal worker MUST do the same when it debits balance to send
   on-chain — decrement both `available` AND `amount`, or move to
   `locked` while pending then drop `amount` on confirmation.
3. The `staking-rewards.ts` materializer has no uniqueness constraint
   preventing `(positionId, windowStart)` duplicates if a future
   second worker instance gets added. Worker concurrency is currently
   1, so this is a latent concern. Phase 7's withdrawal worker may
   share the same "BullMQ scheduler at every:N" pattern; consider
   whether the team-org failure of "two worker pods accidentally
   running" is in scope for any future plant.

## Verdict and recommendation

**PASS.** Green-light Phase 7.

Phase 6 ships four new product surfaces cleanly. The three architect-
allocated plants (V-44, V-45, V-46) are present, exploitable, and
realistically placed. The architect's Gate-2 conditions are all
met. Phase 5 F-1 nit closes via the new `KNOWN_ASSETS` registry. No
pre-existing V-NNN was weakened, removed, or hardened. Tests pass
(74/74), tsc is clean across all four packages, the Next build
succeeds, and the migration adds only new tables (Phase 0-5 columns
untouched).

Build-author may proceed to Phase 7 (withdrawal + treasury + PSBT).

— L7 QA
