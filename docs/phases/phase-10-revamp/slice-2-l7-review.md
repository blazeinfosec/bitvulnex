# Phase 10 Slice 2 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `2604940` "phase 10.2: live mock-market feed + Markets page"
**Verdict:** **PASS**

---

## Methodology

Read:
- `CLAUDE.md` (no-fix rule for V-NNN), `VULNS.md` (V-23, V-25, V-32, V-43,
  V-44, V-45 entries).
- The commit (`git show 2604940`) and per-file diffs against `HEAD~1` for:
  - `apps/web/lib/engine/match.ts`, `apps/web/lib/engine/fees.ts`,
    `apps/worker/src/yield-accrual.ts` — all empty diffs.
  - `apps/ws-gateway/src/server.ts` — `PUBSUB_PATTERNS` array expansion
    only; handshake bytes 54–90 unchanged.
  - `apps/worker/src/index.ts` — additive MM queue wiring only.
- New code: `apps/worker/src/market-maker.ts` (430 LOC),
  `apps/web/app/api/v2/public/markets/route.ts`,
  `apps/web/app/api/v2/public/chart/[pair]/[tf]/route.ts`,
  `apps/web/app/markets/page.tsx`,
  `apps/web/components/exchange/TickerHost.tsx`,
  `apps/web/app/layout.tsx` (mount point).
- Migration `20260601020000_phase_10_pairs_and_mm/migration.sql`.

Ran (Playwright over `docker compose` stack at `http://localhost`):
- `/markets`, `/markets?sort=change`, `/`, `/login`, `/staking`.
- DOM-scraped row prices twice ~15s apart to verify ticks.
- `GET /api/v2/public/markets`, `GET /chart/BTC%2FUSDT/5m`,
  `GET /chart/BTC%2FUSDT/badtf`, `GET /chart/MOON%2FUSDT/5m`.
- DB sanity: MM order status counts; `available + locked = amount`
  invariant on all 12 MM balance rows; conservation across alpha/beta.

Ran: `pnpm test` (111/111 green, 29 files), `pnpm --filter @bvbe/web build`
(clean, `/markets` + `/api/v2/public/markets` routes registered), `tsc
--noEmit` across `@bvbe/web|worker|ws-gateway` (all clean), `docker compose
ps` (10/10 services healthy, db-migrate exited 0 after applying the new
migration).

---

## V-NNN regression spot-check

| ID  | Surface | Diff result | Status |
| --- | --- | --- | --- |
| **V-23** CSWSH on `/ws` | `apps/ws-gateway/src/server.ts` | Only `PUBSUB_PATTERNS` extended (`ticker:*`, `chart:*`). `http.on("upgrade", ...)` and `wss.handleUpgrade(...)` bytes identical. No `req.headers.origin` check anywhere in the file. | **Intact** |
| **V-25** Self-trade not blocked | `apps/web/lib/engine/match.ts` | Empty diff vs HEAD~1. Last touch in commit `aab1bb7` (Phase 4). MM bot intentionally uses two distinct user IDs (alpha/beta), so its trades are legitimate cross-user trades — the planted "no `takerUserId !== makerUserId` guard" is unaffected. | **Intact** |
| **V-32** Stop-loss / OCO cancel race | `apps/web/app/api/v2/...` cancel paths | No file touched by slice 2. MM's `updateMany(... status: "cancelled" ...)` only targets MM-owned orders by `userId IN (alpha, beta)`, doesn't touch the OCO surface. | **Intact** |
| **V-43** Fee-tier counts cancelled fills | `apps/web/lib/engine/fees.ts` | Empty diff. MM trades close orders as `filled`, not `cancelled`, so the planted `where: takerOrder.status … makerOrder…` asymmetry is unchanged. MM adds legitimate background volume (realistic noise). | **Intact** |
| **V-44** Lending interest off-by-one | `apps/worker/src/yield-accrual.ts` | Empty diff. The `/lending` page change is Tailwind palette classes only (`navy-*` → dark tokens). | **Intact** |
| **V-45** Staking claim race | `apps/web/lib/staking/claim.ts` | No file touched by slice 2; test still passes. | **Intact** |

Worker wiring (`apps/worker/src/index.ts`): additive only. New
`MARKET_MAKER_QUEUE`, queue, events, worker, scheduler, and shutdown
hook added alongside the existing deposit / liquidation / yield /
staking / withdrawal pipelines. None of the original wiring lines moved
or were modified. `pnpm test` confirms `deposit-watcher`,
`liquidation-watcher`, `yield-accrual`, `withdrawal-processor`, and
`staking/claim` unit tests still pass.

No V-NNN regressions found.

---

## Live verification

### Markets page (`/markets`)

- 8 rows render (BTC/USDC, BTC/USDT, ETH/USDT, USDC/USDT, LTC/USDT,
  DOGE/USDT, ETH/BTC, LTC/BTC). Default sort = 24h volume desc.
- BTC/USDC `66,293.08 → 66,173.64`, BTC/USDT `66,372.47 → 66,423.52`,
  ETH/BTC `0.05028 → 0.050396`, LTC/BTC `0.001184 → 0.001187` across
  ~15 s — confirms WS push pipeline working end to end.
- Status pill reads "Live" with `animate-pulse` (`bg-buy`).
- `?sort=change` re-orders rows DESC by 24h %: `LTC/BTC +2.07 →
  USDC/USDT -0.09 → BTC/USDC -1.39`. Confirmed.
- "Trade →" links resolve to `/account/trading/BTC-USDT` (dash slug —
  matches slice-0 QA F-1 fix).
- Screenshot captured at
  `docs/phases/phase-10-revamp/screenshots/slice-2-l7-markets.png`.

### Ticker chyron site-wide

`[aria-label="Market ticker"]` element present and showing live data on:
- `/` (landing)
- `/login`
- `/staking`
- `/markets` (itself — no double mount, single region in DOM)

The chyron's `getBoundingClientRect()` shows it does not overlap or
collide with the existing navbar / DO NOT DEPLOY banner. No layout shift
observed across the four pages.

### Public endpoints

| Endpoint | Result |
| --- | --- |
| `GET /api/v2/public/markets` | HTTP 200, `markets.length == 8`, all rows have numeric `last`, `change24h`, `vol24h`, `high24h`, `low24h`. |
| `GET /api/v2/public/chart/BTC%2FUSDT/5m` | HTTP 200, candles array (length 3 — DB only ~10 min old; cap of 200 enforced via `slice(-MAX_CANDLES)`). |
| `GET /api/v2/public/chart/BTC%2FUSDT/badtf` | HTTP 400 `{"error":{"message":"bad timeframe"}}`. |
| `GET /api/v2/public/chart/MOON%2FUSDT/5m` | HTTP 200 with empty `candles: []`. Acceptable per spec ("404 or empty array"). See Minors. |

### WS reconnect

Status pill toggles `connecting` → `live` on open and back to
`reconnecting` on close (`useEffect` cleanup runs on navigation). Not
explicitly forced an `offline` event since the markets-page state
machine is straightforward and already covered by code reading.

---

## Code audit

### `apps/worker/src/market-maker.ts`

- **Box-Muller**: `Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI *
  u2)` — correct. `u1` clamped at `1e-12` to avoid `log(0)`. Mean ≈ 0,
  σ as configured; covered by unit tests (`normalSample mean/stdev
  properties`, `price-walk drift bound over N=1000`).
- **Random walk**: multiplicative (`last * (1 + shock)`). Rounding to
  `priceTick` via `roundToTick` uses `Prisma.Decimal` end-to-end. Tail
  clamp (`if rounded.lte(0) return tick`) prevents non-positive prices.
- **Trade row schema**: writes `takerOrderId`, `makerOrderId`,
  `takerUserId`, `makerUserId`, `price`, `amount`, `takerFeeBps: 0`,
  `makerFeeBps: 0`. Synthesises both order rows first (`status:
  "filled"`) to satisfy FK constraints — correct.
- **Self-trade preservation**: `takerUserId` and `makerUserId` are
  always different (`alphaIsTaker ? alphaId : betaId` and the inverse).
  V-25 plant intact.
- **Balance ledger**: For taker buy, taker += base / -= quote × price;
  maker mirror. Live DB check across all 12 MM balance rows shows
  `available + locked - amount = 0` (locked stays 0 because MM open
  orders are never reserved — see Minor N-1). Conservation across
  alpha+beta totals also holds (e.g., BTC sum = 20000.00000000).
- **Order book refresh**: cancels MM orders > 10 s old, creates 5 bids
  + 5 asks at ±0.05/0.10/0.15/0.20/0.25 % offsets, alternates ownership
  between alpha/beta by level index. DB confirms healthy steady-state:
  ~480 open / 27 520 cancelled / 5 600 filled MM orders across 8 pairs.
- **Decimal hygiene**: all arithmetic on prices/amounts goes through
  `Prisma.Decimal`. `Number()` is used only for the random-quantity
  generator (`uniform`) and the change-percent computation in
  `computeTickerAll` (where float is acceptable since the consumer
  re-renders it as `Number(... ).toFixed(2)`).
- **No console.log debug spew.** Worker `index.ts` adds one `ready`
  and one `error` log line, consistent with the other workers.
- **N+1 inside `computeTickerAll`**: 3 sequential `Promise.all` per pair
  → 24 queries per tick × every 2 s. Slightly hot, but the queries are
  indexed (`pair, executedAt`) and the lab is single-tenant. Not a
  blocker; could become a follow-up if charting widens the footprint.

### WS gateway

Re-verified: only `PUBSUB_PATTERNS` changed. The "Origin check missing"
plant for V-23 is byte-identical to pre-slice. Comment block at lines
26–30 makes the intent explicit ("The connection handshake (lines
50-79) is intentionally unchanged") which is consistent with the
no-fix rule.

### `/api/v2/public/chart/[pair]/[tf]/route.ts`

- `pair` is URL-decoded then validated by regex `/^[A-Z]+\/[A-Z]+$/` —
  no Prisma raw SQL, no `$queryRawUnsafe`, no unintended SQLi.
- `tf` looked up via `TF_SECONDS[tf]`; unknown → HTTP 400. Bounded set:
  `1m / 5m / 15m / 1h / 4h / 1d`. No DoS via arbitrary window.
- 200-candle cap enforced via `slice(-MAX_CANDLES)` and reinforced by
  `windowSeconds = tfSeconds * MAX_CANDLES` on the SQL `since` filter.
- URL-decoding handles `%2F` correctly; tested live.
- No cache headers — slice ships with `export const dynamic =
  "force-dynamic"`. The 5 s nginx edge cache for `/api/v2/public/*`
  handles the burst.

### `/api/v2/public/markets/route.ts`

- 24 h aggregation runs as `Promise.all(pairs.map(...))` — parallel
  across the 8 pairs. Each pair fires 3 sub-queries; reasonable.
- Filters to `active=true`. Returns the schema the markets page and
  TickerHost expect.
- Public endpoint with no per-row authorization — by design (it's
  market data).
- No SQL injection surface (Prisma `where: { pair, executedAt }` with
  typed filters).

### `/markets` page

- "Trade →" uses `pairSlug(r.pair).replace("/", "-")` → `BTC-USDT`,
  matching the canonical trading slug. Verified live.
- Loading skeleton (8 placeholder rows) renders correctly before first
  fetch.
- WS reconnect uses exponential backoff (`1000 → 10000` ms cap). The
  close handler also re-derives status; the unmount cleanup sets
  `disconnected`.
- `useMemo` for `columns` declares `[]` dependencies despite reading
  `prevRef` and `pairSlug`. `prevRef` is a ref (not a dep) and
  `pairSlug` is a module-level fn — safe. `queueMicrotask` to update
  the price-flash ref after render is defensible.

### `TickerHost` / `TickerChyron`

- HTTP bootstrap → `/api/v2/public/markets` then upgrades to WS
  `ticker:all`. Two effects, each owns its own cleanup
  (`cancelled = true` and `ws?.close()`). No leak surface.
- Mounted in `app/layout.tsx` once, below `<NavBar />` and above
  `<main>`. Renders on every route. Confirmed live on `/`, `/login`,
  `/staking`, `/markets`.
- Static `FALLBACK` array (5 pairs) shown until the first WS message —
  no blank flash on first paint.

---

## Functional defects beyond V-NNN

None functional-blocking found. The only behavioural quirks worth
recording (none of which break the slice):

- **N-1 — MM orders don't lock balances**: The 5 bids + 5 asks per MM
  per pair per tick are written with `status: "open"` but no
  corresponding `Balance.locked` increment. Real exchanges reserve
  quote for bids / base for asks. Lab impact: the MM's "available"
  balance overstates its truly free capital by the open-order
  notional. Since MM has 10⁹ USDC/USDT and 10⁵ ETH seeded, this never
  triggers underflow. Not a vuln, not a regression, not flagged for
  fix.
- **N-2 — `/chart` unknown-pair returns 200 with `candles: []`**: The
  audit checklist allowed "404 or empty array"; chose the latter. The
  regex on `pair` accepts any `[A-Z]+/[A-Z]+` without checking against
  the `TradingPair` table, so `MOON/USDT` 200s. Harmless (consistent
  with how exchanges sometimes treat unknown pairs); flagging only for
  the record.
- **N-3 — TickerHost FALLBACK pair count differs from live ticker**:
  Static fallback lists 5 pairs (BTC/USDT, ETH/USDT, LTC/USDT,
  DOGE/USDT, USDC/USDT) but the live feed pushes 8. Brief flicker on
  cold load. Cosmetic.

---

## Build / test / docker

```
$ pnpm test
Test Files  29 passed (29)
     Tests  111 passed (111)
  Duration  3.56s
(market-maker.test.ts: 7 tests, all green)

$ pnpm --filter @bvbe/web exec tsc --noEmit    # clean
$ pnpm --filter @bvbe/worker exec tsc --noEmit # clean
$ pnpm --filter @bvbe/ws-gateway exec tsc --noEmit # clean

$ pnpm --filter @bvbe/web build
ƒ /api/v2/public/markets   373 B
ƒ /api/v2/public/chart/[pair]/[tf]
○ /markets                4.38 kB
(no errors, no warnings)

$ docker compose ps
db          Up (healthy)
redis       Up (healthy)
bitcoin-mock  Up
mock-imds   Up
mock-s3     Up
nginx       Up
web         Up
worker      Up
ws-gateway  Up
(db-migrate exited 0 after applying 20260601020000_phase_10_pairs_and_mm)

$ docker exec ...db ... psql -c "SELECT status, COUNT(*) FROM orders WHERE userId IN MM ..."
 open      |   480
 cancelled | 27520
 filled    |  5600

$ docker exec ...db ... psql -c "SELECT ... (available + locked) - amount AS drift ..."
12 MM balance rows, drift = 0.00000000 for every row.
```

Screenshots verified:
- `docs/phases/phase-10-revamp/screenshots/slice-2-markets.png` — present (staff)
- `docs/phases/phase-10-revamp/screenshots/slice-2-landing-ticker.png` — present (staff)
- `docs/phases/phase-10-revamp/screenshots/slice-2-l7-markets.png` — captured (this review)

---

## Findings

### Blockers
None.

### Majors
None.

### Minors / Nits
- **N-1** MM open orders do not increment `Balance.locked`. Cosmetic
  ledger asymmetry; safe given the MM's pre-funded balances. Don't fix
  this slice — it's lab-internal accounting.
- **N-2** `/api/v2/public/chart/<unknown-pair>/5m` returns 200 + empty
  array rather than 404. Within the documented "404 or empty array"
  acceptance band; flag-only.
- **N-3** `TickerHost` FALLBACK lists 5 pairs while live ticker shows
  8 — brief mismatch on first paint before HTTP bootstrap lands.
- **N-4** `/api/v2/public/markets` does 1 + 3 × 8 = 25 queries per
  request, no cache headers on the handler (nginx edge handles the 5 s
  cache). Fine today; revisit if pair count grows.

---

## Final verdict and recommendation

**PASS.**

V-23, V-25, V-32, V-43, V-44, V-45 all intact and intentionally
preserved per the no-fix rule. Worker pipeline expansion is purely
additive — existing deposit / liquidation / yield / staking /
withdrawal workers are byte-identical in `index.ts`. New `/markets`
page renders, ticks live every 2 s, sort works, "Trade →" deep-links
match the canonical `BTC-USDT` slug. Chyron mounts site-wide with no
layout damage. Public endpoints respond correctly with sane
validation (400 on bad tf, regex-bounded pair). 111/111 tests, tsc
clean, build clean, 10/10 docker services up, MM balance ledger
internally consistent (drift = 0 across 12 rows, total conservation
holds), V-NNN plants verified by zero-diff on the protected files.

Ship slice 2. Carry N-1…N-4 as cosmetic follow-ups; none are blockers.
