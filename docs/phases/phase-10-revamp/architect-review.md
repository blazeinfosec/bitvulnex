# Phase 10 (Revamp) — Architect Review (retrospective)

> **Reviewer:** Senior Architect
> **Date:** 2026-05-29
> **Verdict:** Approved. Phase 10-revamp closes cleanly.

## Why this is a retrospective

Phase 10-revamp is structurally different from phases 0-9. The prior
phases all introduced *new planted vulnerabilities* and ran their
four gates against that vuln allocation. Phase 10 is the **UX
revamp** — it ships zero new V-NNN, and instead makes the
already-shipped exchange feel like a real Binance/Bybit-flavored
trading product. The gate-1 architect work for this phase happened
inline in `plan.md` via the **"Decisions ledger (locked
2026-05-29)"** — 11 rounds of locked design decisions — and was
re-confirmed in each of the eight slice commits via the standard
commit-footer attestation. This document is the formal
retrospective: confirming the plan held, the per-slice L7 reviews
all passed, and the phase exit criteria are met.

## Scope assessment

The plan defined the revamp as four hero surfaces + supporting
slices, sequenced as eight vertical cuts (slice 0 triage + slices
1-7). A real exchange team would do exactly this: rebuild the look
and feel against a unified design system, add a live mock-market
feed, and polish for mobile + a11y last. The architect signs off on
the scoping: no slice tried to do too much, and no slice was
backend-only or frontend-only.

The slice-by-slice mapping to plan.md headings:

| Slice | Commit | Plan §                                   | L7 verdict |
|-------|--------|------------------------------------------|------------|
| 0     | `ffc3808` + `6668781` (fix) | Triage + docker bring-up         | PASS WITH NITS |
| 1     | `7e4bbed`               | Design system foundation + login/signup | PASS WITH NITS |
| 2     | `2604940`               | Live mock-market feed + Markets page    | PASS WITH NITS |
| 3     | `84f055b` + `7a46632` (fix) | Unified Earn dashboard              | PASS WITH NITS |
| 4     | `72b15fe` + `3b452e9` (fix) | Trading view (book + chart + form)   | PASS WITH NITS |
| 5     | `f8f23d2` + `02564bc` (fix) | Portfolio + equity curve + welcome   | PASS WITH NITS |
| 6     | `a5cd390` + `835297a` (fix) | Migrate remaining pages to dark      | PASS WITH NITS |
| 7     | `af66a32`               | Polish + a11y + mobile + carry-forward  | PASS WITH NITS |

Eight slices shipped, eight L7 reviews on disk under
`docs/phases/phase-10-revamp/slice-N-l7-review.md`, every one
PASS WITH NITS, every fast-follow nit either committed against
the same slice or carried into slice 7's polish pass and closed
there. Zero slices required a return-to-staff loop after L7
review.

## Vuln allocation review

Phase 10-revamp's vuln allocation was **zero new V-NNN**. The phase
is a UX redesign on top of an already-planted catalog; the explicit
contract per the plan was "do not perturb planted vulns; treat
backend handlers, middleware, schema, nginx, and ws-gateway as
read-only unless a slice requires an additive endpoint."

The architect verified at HEAD:

1. **Backend empty-diff promise held** for every V-NNN-bearing
   surface. `git diff ffc3808~1..af66a32 --` against the planted
   catalog locations confirms:
   - `apps/web/middleware.ts` — empty diff (V-6, V-35 intact).
   - All planted API route handlers — empty diff (V-1 server,
     V-3, V-4, V-21, V-22, V-26, V-27, V-28, V-30, V-33, V-40,
     V-41 server, V-42, V-43, V-44, V-45, V-46, V-47, V-48,
     V-49, V-51 all intact).
   - `apps/web/lib/` — only NEW phase-10 helpers
     (`portfolio/activity.ts`, `trade/{confirm,depth,pair}.ts`)
     and their tests. No existing planted helper modified.
   - `packages/db/prisma/schema.prisma` — phase 10 adds the
     `Pair` and `MarketMaker` models (slice 0) and
     `EquitySnapshot` (slice 5); the `RefreshToken` model's
     planted shape (no `usedAt` / `revokedAt`) is unchanged at
     line 391-399.
   - `apps/ws-gateway/src/server.ts` — touched once (slice 2 to
     add the mock-market ticker channel). The slice 2 diff
     contains zero lines mentioning `origin` / `Origin`; V-23
     (CSWSH) origin-check absence and token-in-query-string
     plant intact at line 68-70.
   - `nginx/nginx.conf` — touched in slice 0 (config refresh)
     and slice 2 (WS upgrade routing). The phase-10 strip list
     still omits `x-bvbe-internal-trace` (V-6) and
     `x-bvbe-desk-role` (V-46); the three CL/TE-tolerant
     directives (`ignore_invalid_headers off`,
     `underscores_in_headers on`, `proxy_pass_request_headers
     on`) remain in the catch-all location block; V-50 intact.
   - `docker-compose.yml` — `NODE_OPTIONS:
     "--insecure-http-parser"` present (V-50 second half).

2. **No accidental signposting** — the slice 6 N-1 finding
   (five `// V-NN reach:` comments added during slice 6) was
   closed by `835297a` and never reintroduced. At HEAD,
   `grep -rEn "V-[0-9]+" apps/web/{app,components,lib,styles}`
   returns zero hits.

3. **No `// TODO: fix this`, `// FIXME`, `// XXX`, `// HACK`,
   `// insecure`, or `// VULN` comments** anywhere in the
   touched tree.

The catalog is intact at 40 entries. No drift between `VULNS.md`
and the codebase introduced by phase 10.

## Exit criteria — all 10 items met

The plan locked 10 exit criteria. The architect verifies each at
HEAD (`af66a32` + the three follow-up commits through `a773ffd`):

1. ✅ **Landing has a live ticker chyron updating every 2s.**
   `apps/web/components/exchange/TickerChyron.tsx` and the
   `TickerHost` mount in `app/layout.tsx` drive the chyron from
   the ws-gateway `ticker:all` channel.

2. ✅ **Trading view shows live book, recent trades, candle chart,
   and serious order form with BalancePill front-and-center.**
   `/trade/BTC-USDT` renders all four. Confirmed in
   `slice-4-l7-review.md` and re-verified at HEAD via HTTP smoke
   (200) and `slice-7-trade-{desktop,mobile}.png` screenshots.

3. ✅ **Earn page shows available, staked, accrued with clear
   monospace numbers. No 403-with-no-context.** `slice-3-l7-review.md`
   confirmed; ClaimModal body-keyed branching in slice 7 closes the
   "200-with-zero-rows" edge case that previously surfaced ambiguous
   error copy.

4. ✅ **Account dashboard shows equity curve, balances, activity.**
   `/portfolio` and the equity-snapshot worker; `slice-5-l7-review.md`
   verified; slice-5 M-1 (live-equity / worker symmetry) closed via
   the shared `computeUserEquityUsd` helper (`02564bc`).

5. ✅ **Every page is dark, Binance-flavored, dense, monospace
   numbers.** 17 pages migrated across slices 1, 5, 6, 7. Final
   sweep in slice 7 cleaned up `forgot/page.tsx`, `reset-form.tsx`,
   `account/{keeper,margin,orders,page}.tsx`, `about/changelog/page.tsx`
   and the legacy `navy-` Card / Button variants. `slice-6-l7-review.md`
   audited all 17 routes at 200.

6. ✅ **All 40 planted V-NNN still exploitable.** See §"Vuln
   allocation review" above and the companion `adversarial-qa.md`
   in this directory. The 2026-05-28 `HOLISTIC-L7-REVIEW.md`
   verified every plant intact at the pre-phase-10 baseline; the
   architect re-spot-checked the five V-NNNs whose source files
   were touched by phase 10 (V-13 login redirect, V-23 ws-gateway,
   V-46/V-6 nginx strip list, V-50 CL/TE directives) and confirmed
   each construct unchanged at the cited offset.

7. ✅ **`pnpm test` passes ≥ 104.** Current: 164/164 across 35
   files (35 → 35 files, 102 → 164 tests). New tests added by
   phase 10: confirm/depth/pair/activity unit tests, equity
   snapshot tests, the slice-7 fence-post additions.

8. ✅ **`pnpm next build` succeeds.** Verified at HEAD:
   `pnpm --filter @bvbe/web build` → "Compiled successfully in
   9.6s", 44/44 static pages generated.

9. ✅ **`docker compose up -d` brings up green, including the
   new market-maker worker.** Verified: 9/9 services
   (`bitcoin-mock`, `db (healthy)`, `mock-imds`, `mock-s3`,
   `nginx`, `redis (healthy)`, `web`, `worker`, `ws-gateway`).
   The market-maker is the slice-2 mock-feed publisher hosted
   inside `worker`; the slice-0 migration `20260601020000_phase_10_pairs_and_mm`
   seeds the `Pair` and `MarketMaker` rows it consumes.

10. ✅ **Mobile (375×667) renders cleanly on hero surfaces.**
    Slice 7 added the MobileNav drawer, the BottomSheet for the
    /trade order form, and shrink-0 fixes for status pills. The
    seven slice-7-* mobile screenshots in
    `docs/phases/phase-10-revamp/screenshots/` document the
    landing, markets, earn, and trade surfaces at 375×667.

## Deviations from the plan worth noting

- **Eight slices instead of seven.** The plan listed slices 0-7
  (eight cuts; slice 0 was the "triage + fix the urgent staking
  complaint" prelude). The slice count matches the plan.

- **No new V-NNN added.** Plan was explicit on this. Honored.

- **Four fast-follow fix commits.** Slices 0, 4, 5, 6 each had a
  L7-driven fix commit between them and the next slice. This is
  the right discipline; it would have been a smell to bundle the
  fixes into the next slice's main commit.

- **`HOLISTIC-L7-REVIEW.md` is dated 2026-05-28 and covers
  phases 0-9 only.** It does not include phase 10. The
  architect signs off on this as expected: the holistic review
  is point-in-time and was correct at its date. A refresh that
  incorporates phase 10's clean V-NNN preservation would be
  the natural next document to land if the project continues.

## Surfaces unchanged

Phase 10 leaves alone (verified empty-diff over the full phase
range):

- Every planted route handler in `apps/web/app/api/v2/`.
- `apps/web/middleware.ts`.
- Every planted module in `apps/web/lib/{withdrawal,treasury,otc,
  staking,lending,engine,kyc-storage.ts,kyc-tier.ts}`.
- `packages/shared/src/{jwt,jwt-v1,markdown,btc-address,psbt-envelope,
  password,totp,yield}.ts` (only the new `equity.ts` was added).
- `apps/ws-gateway/src/server.ts` planted constructs (only the
  ticker-publishing branch is new — additive, not modifying the
  upgrade handler).
- `nginx/nginx.conf` planted directives + strip list.
- `docker-compose.yml`'s `--insecure-http-parser` flag.

## Conditions for phase closeout: all met

1. ✅ All eight slices committed with the standard architect /
   adv QA / paranoid QA footer attestation.
2. ✅ All eight L7 reviews on disk, all PASS WITH NITS.
3. ✅ All ten plan-defined exit criteria verified at HEAD.
4. ✅ V-NNN catalog intact at 40 (per `adversarial-qa.md`).
5. ✅ No real secrets, no mainnet, no real PII, no outbound
   third-party calls introduced by phase 10 (per
   `paranoid-qa.md`).
6. ✅ Tests 164/164, tsc clean, `next build` succeeds, docker
   9/9 up.

## Architect verdict: APPROVED

Phase 10-revamp closes. The exchange now looks and feels like a
real trading product without weakening the planted catalog. The
slice discipline held across all eight cuts. The per-slice L7
reviews caught every regression early — including the slice-6
signposting slip that would have been a real lab-quality
problem in a future audit.

— Architect
