# Phase 10 Slice 4 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `72b15fe` "phase 10.4: trading view (book + chart + form)"
**Verdict:** BLOCK

The hero surface is **shipped with two interlocking WS schema-mismatch
defects** that leave the most important panel (order book) and the
trade tape **visibly empty in steady state** for every user, every
session, on the route they exist to serve. The rest of the slice
(routes, redirects, types, tests, build, mobile, modal, V-NNN
preservation) is clean.

## Methodology

- Read: `CLAUDE.md`, `VULNS.md` (V-4, V-22, V-23, V-25, V-27, V-32,
  V-43 entries), commit `72b15fe` (33 files, +3116/-298).
- Inspected source: `apps/web/app/trade/[pair]/page.tsx`,
  `…/trading-client.tsx`, all 10 new
  `apps/web/components/exchange/trade/*` components, 3 new
  `apps/web/lib/trade/*` helpers + their 26 tests,
  `apps/web/app/api/v2/me/orders/[id]/route.ts` (V-4 surface),
  `apps/worker/src/market-maker.ts` (WS publisher), and the legacy
  redirect at `apps/web/app/account/trading/[pair]/page.tsx`.
- Ran: `pnpm test` (137/137 pass), `pnpm --filter @bvbe/web exec tsc
  --noEmit` (exit 0), `docker compose ps` (9/9 up),
  `git diff HEAD~1 HEAD -- <V-NNN paths>` for each preservation
  claim.
- Drove live Playwright sessions on `http://localhost/trade/BTC-USDT`
  as anonymous, then signed in as `admin@bvbe.local`. Verified order
  type switching, confirm modal trigger, mobile bottom sheet, redirects,
  bad-slug 404s, V-4 IDOR via REST.
- Cross-checked the live React fiber state vs the REST API shape to
  trace the empty-orderbook root cause.

## V-NNN regression spot-check

| V-NNN | Path | diff HEAD~1 HEAD | Source check | Verdict |
|-------|------|------------------|--------------|---------|
| V-4   | `apps/web/app/api/v2/me/orders/` | empty | `findUnique({where:{id:orderId}})` lacks `userId:claims.sub` (route.ts:25, 49) | **intact** |
| V-22  | `apps/web/app/account/orders/edit-order.ts` | empty | (no diff) | **intact** |
| V-23  | `apps/ws-gateway/src/server.ts` | empty | (no diff) | **intact** |
| V-25  | `apps/web/lib/engine/match.ts` | empty | (no diff) | **intact** |
| V-27  | `apps/web/lib/kyc-tier.ts` | empty | (no diff) | **intact** |
| V-32  | `apps/web/lib/engine/place.ts` | empty | OrderForm exposes Stop-Limit + OCO tabs → fresh UI reach for the planted race | **intact + reachable** |
| V-43  | `apps/web/lib/engine/fees.ts` | empty | (no diff) | **intact** |

**Live V-4 PoC** (admin session, victim order = MM-bot user, both via
the same UI endpoint that MyOrdersTable's Cancel button calls):

```
# 1. Log in as admin
POST /api/v2/auth/login {email:admin@bvbe.local,password:change-me-…} → 200 access

# 2. Read someone else's order (planted IDOR — GET branch)
GET /api/v2/me/orders/363937
Authorization: Bearer <admin access>
→ 200 {
    "id":363937,
    "userId":"cmpqn82o40008h7k0pu62eyw3",   ← NOT admin
    "pair":"USDC/USDT", "side":"sell", "price":"0.9972", "amount":"41.44797163",
    "status":"open"
  }
```

DELETE on the same endpoint is the planted cancel-as-griefing primitive
and is wired to `MyOrdersTable.tsx`'s per-row Cancel button. (My live
DELETE PoC against a specific order races with the MM bot's churn so
the order had already been re-cancelled in the millisecond gap — the
GET PoC alone is sufficient to demonstrate the missing ownership
filter; same handler, same `findUnique` line, same lack of `userId`
check.)

## Live verification

| Check | Result |
|------|--------|
| Anonymous `/trade/BTC-USDT` 3-col desktop, chart, header, gated form | OK (form correctly disabled, "KYC Tier 1 required" tooltip) |
| Admin (tier 3) signed in, Buy BTC button enabled | OK |
| 4 order types — Limit / Market / Stop-Limit / OCO | OK; Stop-Limit shows "Stop trigger (USDT)"; OCO shows "Stop trigger / Stop-loss (USDT)" + explainer |
| Market type disables Price input, allows Amount | OK (`disabled=true`, placeholder `"Market"`) |
| Pre-trade confirm modal trigger (Market 0.05 BTC ≈ $3,200) | OK — modal shows Pair/Side/Type/Amount/Price/Total + ⚠ "Market order notional exceeds $1,000." |
| Cancel in confirm modal → no submit | OK |
| Mobile 375×667 single-column stack | OK |
| Fixed bottom "Trade BTC" CTA | OK |
| Bottom-sheet opens with the OrderForm inside | OK ("Trade BTC/USDT" title, X close, full form) |
| `/account/trading/BTC-USDT` → 307 → `/trade/BTC-USDT` | OK |
| `/trade/MOON-USDT` and `/trade/lowercase-usdt` | OK — both return 404 cleanly |
| WS pill reads "Live" on `/trade` and `/markets` | OK |
| `/markets` `Trade →` links point to `/trade/<slug>` | OK (25 trade links) |
| **Order book panel renders levels** | **FAIL — see Blockers** |
| **Recent trades feed populates from WS** | **FAIL — see Blockers** |

## Component audit

- `OrderBook.tsx` / `OrderBookSide.tsx` / `OrderBookSpread.tsx` — bucketing
  math (lines 34–66) is correct (verified by running the bucketize fn
  against live `/api/v2/public/book` data → 15 buckets each side). The
  *component* is fine; the *data* it receives from the page is
  malformed in steady state. See blocker B1.
- `OrderForm.tsx` — clean state model, tier gates on the right tiers
  (TIER_REQUIRED_FOR_TRADE=1 line 54, TIER_REQUIRED_FOR_ADVANCED=2 line
  55). Submit guard `canSubmit` correctly demands amount+price+stop
  validity. ConfirmModal labels each trigger correctly. `pickPctAvailable`
  computes `quoteAvailable / refPrice` for buys and `baseAvailable` for
  sells — confirmed the slice-0 integer-stripping bug is *not*
  reintroduced (BalancePill shows full 99,960 USDT, not 9).
- `CandleChart.tsx` — lazy-loaded via `dynamic(..., { ssr: false })`
  with a skeleton fallback (trading-client.tsx:27–30). Renders. TradingView
  attribution link visible.
- `MyOrdersTable.tsx` — Cancel button per row calls
  `DELETE /api/v2/me/orders/:id` — V-4 reach confirmed (a tab strict-mode
  locator collision while clicking the confirm-modal Cancel surfaced the
  in-table Cancel for an open order placed earlier in the session).
- `BottomSheet.tsx` — sheet renders with backdrop + title bar + X close
  + slide-up animation. One form instance per viewport confirmed (the
  desktop column doesn't mount the same form when mobile is open and
  vice-versa, per the conditional render block at lines 350–425 of
  trading-client.tsx).
- `PairHeader.tsx` — header populates correctly (last, change, hi/lo,
  vol) once `/api/v2/public/markets` lands. There is a transient
  zero-state on first paint when the markets endpoint hasn't returned
  yet (last shows `0`, hi/lo show `—`). Self-corrects in <2s.

## Helper tests audit

- `pair.test.ts` (12 tests) — covers slug↔pair parsing, rejects
  lowercase/slash-form mismatches, aggregation presets per pair family,
  dp helpers. No test pins a planted V-NNN. Solid.
- `confirm.test.ts` (7 tests) — exercises both triggers across stable
  and non-stable quote pairs, including the ETH/BTC → USD conversion.
  **Minor**: no boundary test for exactly-10%-of-balance or
  exactly-$1000 market notional. Spec says `>` (strict); implementation
  matches (confirm.ts:77 `> input.available * 0.1`, line 88
  `> 1000`). Add a fence-post case if you want belt-and-braces.
- `depth.test.ts` (7 tests) — cumulative monotonicity, null/zero
  filtering, bounds, degenerate-range guard, closed SVG path. Solid.

## Functional defects beyond V-NNN

### Blockers

**B1. Order book is empty in steady state (WS payload shape mismatch).**

- **Where:** `apps/web/components/exchange/trade/OrderBook.tsx:8-12`
  defines `RawLevel = { price, remaining }` and reads
  `lvl.remaining` in `bucketize` at line 45.
- **What sends the data:** `apps/worker/src/market-maker.ts:206-207`
  publishes book snapshots over the `book:<pair>` Redis channel as
  `{ price, amount }`, *not* `{ price, remaining }`. The MM bot fires
  every ~1s; trading-client.tsx:205–218 accepts both `kind:"book"`
  (snapshot with bids/asks embedded) and `kind:"book_update"`
  (no-payload nudge → refetch via REST).
- **Why the REST fallback does not save us:** the snapshot branch
  overwrites `book` state with `{price, amount}` rows on every MM
  tick. `bucketize` then computes `size = Number(undefined) = NaN`
  for every level → all filtered out → `bidRows = askRows = []` →
  every `<li>` in OrderBookSide renders empty content. Live React
  fiber inspection of the current `book` state on the trade page
  confirmed `bids: [{price:"64392.59", amount:"0.00130499"}, …]` —
  rows present, but keyed on the wrong field.
- **User-visible effect:** all 30 order book rows blank, spread shows
  `— (—)`, depth chart shows "no depth", click-to-fill-price is
  unreachable (rows aren't interactable when empty). Reproduces in
  both anonymous and admin sessions; reproduces on every pair.
  Slice-4-introduced (the consumer side, `RawLevel`, was new in this
  commit; the publisher side has been emitting `amount` since 10.2).
- **Fix scope (non-V-NNN, lab-functional):** either rename the
  consumer's field to `amount` (1-line type change in OrderBook.tsx,
  plus `Number(lvl.amount)` in bucketize and DepthChart.tsx), or rename
  the publisher to `remaining` (1-line change in market-maker.ts:206-207
  plus its unit-test fixture). The REST endpoint
  (`/api/v2/public/book/[pair]/route.ts`) emits `remaining`; renaming
  the publisher to match the REST shape is the more idiomatic fix.

**B2. Recent trades feed never populates from WS.**

- **Where:** `apps/web/app/trade/[pair]/trading-client.tsx:219-223`:
  ```ts
  } else if (msg.kind === "trade" || msg.kind === "trades") {
    const incoming = msg.trades ?? (msg.trade ? [msg.trade] : []);
    if (incoming.length > 0) { setRecent(prev => [...incoming, ...prev].slice(0, 50)); }
  }
  ```
- **What sends the data:** `apps/worker/src/market-maker.ts:399-409`
  publishes `{ kind: "trade", pair, price, amount, side, at }`. The
  trade payload is on the top-level message — no `trade:` or `trades:`
  envelope. So `msg.trades` and `msg.trade` are both undefined and
  `incoming` is always `[]`.
- **User-visible effect:** Recent Trades panel reads "Recent trades
  will appear here when the market is active" forever, on a market the
  MM bot is actively trading every second. Confirmed live.
- **Fix scope:** either change trading-client.tsx to read
  `msg.kind === "trade"` as a single trade at the top level (and adapt
  to the field names the publisher uses — `amount`, `at`, `side`), or
  change the publisher to wrap as `{ kind: "trade", pair, trade: {…} }`.
  Either is one-screen of work.

These two blockers ship a hero surface where the two real-time panels
that are supposed to feel alive are visibly dead. They are not V-NNN —
the planted vulns aren't about "the UI shows the data correctly", they
are about backend trust boundaries and engine logic. These are plain
functional defects.

### Majors

None.

### Minors / Nits

- **M1.** Anonymous user sees order-form gate copy "KYC Tier 1 required
  to trade. Complete identity verification to enable orders." even
  when they are not signed in at all. The copy assumes a logged-in
  tier-0 user; a not-signed-in user should see a "Sign in to trade"
  affordance (with a `?next=/trade/BTC-USDT` link). Low-effort copy
  swap with a conditional on `me === null` vs `(me.kycTier ?? -1) < 1`.
  (Also coincidentally relevant for V-13 — the open-redirect `?next=`
  needs an inbound user-flow.)
- **M2.** MyOrdersTable fires `/api/v2/me/orders?status=open` and
  `?status=partial` requests even when the user is anonymous; they
  401 cleanly but produce console errors and pointless network noise.
  Wrap in a `me && …` guard, or render the table only when
  `me !== null`.
- **M3.** `trading-client.tsx:226` shadows the closure-scope `me` with
  `const me = msg.rows.find(...)` inside the `kind:"ticker"` branch.
  Block-scoped, so functionally fine, but a hand-shaped foot-gun if
  someone later moves code around. Rename to `mine` or `myRow`.
- **M4.** `shouldConfirm` tests don't exercise the exact-boundary case
  (notional == 10% of balance; market notional == $1000.00). Add one
  test each so future refactors can't silently flip strict ↔ inclusive
  inequalities.
- **M5.** WS reconnect backoff capping at 10s is reasonable, but the
  pill flickers `connecting → live → reconnecting → connecting → …`
  on every reconnect because the open handler also reads the previous
  state via `setWsStatus(s => s === "live" ? "reconnecting" : "connecting")`
  (line 177) — on a fresh connect this is a one-tick blip. Cosmetic.

## /markets page integration

- WsStatusPill extraction works — markets page renders the pill and it
  reads "Live" while the gateway is up.
- 25 `<a href="/trade/<slug>">` anchors on the markets page (one Trade
  link per ticker + dupes from the ticker chyron). URLs use the
  hyphenated slug. The TickerChyron change (slice-4 file) is consistent.

## Build / test / docker

- Tests: **137/137 pass** (32 files). New trade tests: pair(12) +
  confirm(7) + depth(7) = 26. Matches commit claim.
- TypeScript: `pnpm --filter @bvbe/web exec tsc --noEmit` → exit 0.
- Docker: 9/9 services up (`web`, `worker`, `ws-gateway`, `nginx`, `db`,
  `redis`, `bitcoin-mock`, `mock-imds`, `mock-s3`).
- Build/bundle: commit reports `/trade/[pair]` 6.11 kB route + 181 kB
  first-load. Did not re-run `pnpm build` to verify; tsc-clean +
  helpers all pure + new components all standard React makes the
  reported number plausible. `lightweight-charts` is dynamically
  imported (trading-client.tsx:27), so it cannot land on `/` or
  `/markets` — code-split correct by construction.

## Final verdict and recommendation

**BLOCK.** Two blocker-class functional defects (B1: order book empty;
B2: trade feed empty) make the hero surface fail its stated purpose for
every visitor. Both root-cause to a field-name disagreement between
the slice-4 WS consumer (`remaining`) and the slice-10.2 publisher
(`amount`), with the new code being the one that introduced the
mismatch. Estimated fix: < 30 minutes for either direction (consumer
or publisher), plus a small unit test asserting the publisher and the
REST endpoint share a schema.

Once B1 + B2 land, re-verify:

1. `/trade/BTC-USDT` shows 30 order-book rows with depth bars after
   the first MM tick (≤ 2s).
2. Recent Trades panel shows new entries scrolling in.
3. DepthChart renders the cumulative ask + bid area (currently shows
   "no depth" only because there are no points).
4. Click-on-orderbook-row populates the OrderForm price input
   (`onPickPrice`).
5. The `bvbe.ui.book.agg.<pair>` localStorage persistence still works
   when the rows are non-empty.

Everything else — V-NNN preservation (all 7), routes, redirects,
modal, mobile sheet, type tabs, tier gates, build, tsc, tests, docker,
helpers, markets integration — passes. Once the two WS-shape bugs are
fixed, this is a clean slice-4 with no other ship-blocking concerns.

— end of L7 review —
