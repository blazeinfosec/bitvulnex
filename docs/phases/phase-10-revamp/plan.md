# Phase 10 — UX Revamp ("Make it look like a real exchange")

> **Mandate from owner (2026-05-29):** the lab currently reads as
> tutorial scaffold, not an exchange. The current UI doesn't sell
> the fiction that this is a real custodial Bitcoin venue —
> trainees won't believe they're attacking a serious system if it
> looks like an admin panel. Specific complaints:
>
> - "Doesn't look like a crypto exchange." Generic light-theme
>   admin layout, no market-data chrome, no live feel.
> - "Staking page — I don't even fucking know how much I have or
>   how much I can stake." Balances aren't surfaced where they
>   matter. 403s show up in places where the user has no context.
> - "Where's the ticker?" No market chyron, no live prices, no
>   depth, no recent trades stream.
> - "Lots of elements seem missing." Forms exist; the surrounding
>   exchange UX doesn't.
>
> **Decisions locked from owner interview:**
>
> 1. **Aesthetic: Binance / Bybit dark.** Dense info, dark theme,
>    yellow/orange accents on black, red/green for sides, leverage
>    selectors front and center, monospace numbers.
> 2. **Scope: Full overhaul + missing UX.** New design system
>    end-to-end, every page redesigned, missing widgets added,
>    UX gaps closed. Plants stay intact.
> 3. **Hero surfaces (all four).** Landing with ticker chyron;
>    trading view (book + chart + form); account dashboard /
>    portfolio; Earn (lending + staking) dashboard.
> 4. **Data realism: live mock feed.** Background price walker
>    nudges BTC/ETH every few seconds; order book updates visibly;
>    recent-trades scrolls; charts render real candles from
>    seeded history.

## Scope assessment

This is a major undertaking. The existing codebase has 40 planted
V-NNN, four killer chains, 10 docker services, 104 tests. None of
that changes; what changes is the *rendering layer* and the
*missing data surfaces*.

The owner is frustrated. The plan must ship value quickly, not
just paint a roadmap. Sequencing is therefore **vertical slice
first**: each slice produces a visibly-better page that the owner
can open in a browser, not a refactor that takes 3 days before
anyone sees anything.

**Out of scope explicitly:**
- Reworking the planted-vuln surface. V-1's
  `dangerouslySetInnerHTML` stays. V-22's Server Action stays.
  V-46's header read stays. The fiction looks better; the holes
  underneath are unchanged.
- Building a real TradingView chart from scratch. We will use the
  `lightweight-charts` library (Apache-2.0, no third-party calls,
  no external CDN, ~50KB) which is the actual TradingView
  open-source charting library.
- Real market data. The "live feed" is a worker job that walks
  seeded prices; no outbound HTTP to a real exchange.

## Design system foundation (slice 1)

### Color palette (Binance-flavored dark)

| Token              | Hex      | Use                                    |
|--------------------|----------|----------------------------------------|
| `bg`               | `#0B0E11`| Page background — Binance signature    |
| `bg-elevated`      | `#181A20`| Cards, panels, modals                  |
| `bg-hover`         | `#2B3139`| Row hover, button hover                |
| `border`           | `#2B3139`| Hairline borders, table dividers       |
| `border-subtle`    | `#1E2329`| Lighter dividers between rows          |
| `text`             | `#EAECEF`| Default text                           |
| `text-dim`         | `#B7BDC6`| Secondary labels                       |
| `text-mute`        | `#848E9C`| Tertiary, timestamps, helper text      |
| `accent`           | `#FCD535`| Binance yellow — CTAs, highlights      |
| `accent-hover`     | `#F0B90B`| CTA hover                              |
| `accent-text`      | `#202630`| Text ON accent (dark on yellow)        |
| `buy`              | `#0ECB81`| Long, bid, buy — green                 |
| `buy-dim`          | `#0A7C50`| Buy backgrounds, depth bars            |
| `sell`             | `#F6465D`| Short, ask, sell — red                 |
| `sell-dim`         | `#80323F`| Sell backgrounds, depth bars           |
| `warn`             | `#F0B90B`| Warnings, leverage > 5x                |
| `info`             | `#5C8EFF`| Info pills                             |

Existing semantic CSS variables in `apps/web/app/globals.css`
(navy/white tokens from Phase 0) are kept as a legacy compatibility
layer until all pages migrate, then deleted.

### Typography

- **UI font**: Inter (already installed). Sizes step
  `xs=11px md=13px base=14px lg=16px xl=20px 2xl=28px 3xl=36px`.
- **Numeric font**: IBM Plex Mono (new — add `@fontsource/ibm-plex-mono`).
  Tabular nums, right-aligned for prices and quantities. This is
  the single biggest visual signal of "exchange-grade."
- **Headings**: tighter line-height (1.1), denser leading.

### Component library (new)

To live in `apps/web/components/exchange/`:

- **`<TickerChyron>`** — top-of-page horizontal scrolling band
  showing all pairs with last + 24h%. Animates via CSS
  `marquee`; updates from a WS subscription. Used on landing
  and trading pages.
- **`<MarketPill>`** — one row of a market list: pair name, last,
  24h%, 24h vol. Click → navigates to trading page for that pair.
- **`<PriceCell>`** — monospace, color-codes on tick:
  green flash up, red flash down, neutral after 500ms.
- **`<NumberCell>`** — right-aligned monospace, configurable
  precision (`{value, dp, prefix?, suffix?}`).
- **`<PercentChangeCell>`** — colored `+1.23%` / `-0.45%`.
- **`<StatCard>`** — big number + label + optional delta. Used
  on dashboards.
- **`<OrderBookRow>`** + **`<OrderBookSide>`** — rendered list
  of `{price, size, cumSize}`. The row has a depth-bar background
  scaled to `cumSize / maxCumSize`. Bids stacked top-down with
  buy-dim depth bars, asks stacked bottom-up with sell-dim.
- **`<OrderBookSpread>`** — middle row, shows
  `last · spread · spread%`.
- **`<DepthChart>`** — SVG line of cumulative bid + ask.
- **`<RecentTradesFeed>`** — scrolling list of trades with
  side-color and timestamp.
- **`<PositionCard>`** — for margin: side, size, entry, mark,
  liq, P&L. Liq price has a red border when within 5% of mark.
- **`<OrderRow>`** — open order, with cancel button.
- **`<LeverageSlider>`** — 2x/3x/5x/10x pill selector.
- **`<SideToggle>`** — large Buy (green) / Sell (red) tabs at
  the top of the order form.
- **`<BalancePill>`** — `Available: 0.42 BTC` everywhere the user
  needs to know the constraint before they type. Closes the
  staking complaint specifically.
- **`<DataTable>`** — base with sticky header, virtualized rows,
  dark hover state, monospace cells where appropriate.
- **`<Skeleton>`** — pulse loader for tables/cards while data
  loads.
- **`<EmptyState>`** — friendly message + action button for
  empty tables ("No open orders. [Place your first order →]").

### Tailwind config update

`apps/web/tailwind.config.ts`:
- Add the dark palette tokens
- Add `font-mono: ["IBM Plex Mono", "monospace"]`
- Force `darkMode: "class"` and apply `class="dark"` on
  `<html>` in the root layout (no light-mode toggle; lab is
  dark-only)
- Custom `boxShadow.elevated` for cards

### DO NOT DEPLOY banner

Currently a red bar at the top + footer. Stays — but restyled
to the dark palette so it doesn't clash. Pale-yellow on the
deep-black, less aggressive. Lab safety preserved.

## Live mock market feed (slice 2)

The seeded order book exists; what's missing is movement.

### `apps/worker/src/market-maker.ts` (new)

BullMQ repeatable job every 2s. For each active TradingPair:

1. Read last trade price from DB (fallback to a seeded start).
2. Random-walk: `next = last * (1 + N(0, σ))` where σ is per-pair
   (`BTC/USDT: 0.0005`, `ETH/USDT: 0.0008`).
3. Generate a synthetic trade between two "market-maker" seed
   users (`mm.alpha@bvbe.local`, `mm.beta@bvbe.local`) — they
   trade against each other at the new price. Tiny volumes
   (`0.001 - 0.01 BTC`). Write a Trade row.
4. Refresh the order book: cancel stale maker orders, place new
   bids/asks around the new mid at `±0.05% / ±0.10% / ±0.20%`.
   Maintains visible book depth.
5. Publish `book:BTC/USDT` and `trades:BTC/USDT` events to Redis
   pub/sub — the WS gateway fans them out.

This work runs alongside the existing matching engine and yields
real Trade rows + real Order rows, so V-25 (self-trade)
manipulation still works exactly as planted — the planted vuln
just now has a busier background to hide in. **CHAIN C gets
realer:** a trainee's self-trade now shows up on the public
ticker AS A TICK on top of organic market-maker noise.

### WS gateway extensions

Existing channels: `book:<pair>`, `trades:<pair>`, `private:<userId>`.
Add: `ticker:all` (compact 24h-summary fanout, used by the
chyron) and `chart:<pair>:<tf>` (candle updates for the
trading-view chart).

The chyron and trading view subscribe over WS to get live
updates. The Markets page falls back to SSR-then-hydrate so
crawlers and trainees with WS blocked see static prices.

## Hero surface 1 — Landing (slice 3)

Current: a header, login/signup, generic copy.

New: Binance-style marketing-meets-product landing.

```
┌────────────────────────────────────────────────────────────────────┐
│ [⚠ DO NOT DEPLOY banner — pale yellow on black]                    │
├────────────────────────────────────────────────────────────────────┤
│ Bitvulnex          Markets  Trade  Earn  Derivatives  Docs   Sign in [→]│
├────────────────────────────────────────────────────────────────────┤
│  BTC 67,234.50 +1.23% │ ETH 3,422.10 +0.55% │ LTC 78.50 -0.30% │ ▶ │ ← TickerChyron
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Trade Bitcoin like an institution.                               │
│   Spot, margin, lending, OTC. Low fees, deep liquidity, regtest    │
│   sandbox for serious testing.                                     │
│                                                                    │
│   [ Get started — it's free  ▸ ]   [ View markets ]                │
│                                                                    │
│                                                                    │
│   ┌──── Top movers ────────────────────────────────────────────┐   │
│   │ Pair          Last       24h %     24h Vol     Action       │   │
│   │ BTC/USDT   67,234.50    +1.23%   $1.2B    [ Trade ▸ ]      │   │
│   │ ETH/USDT    3,422.10    +0.55%   $480M   [ Trade ▸ ]      │   │
│   │ LTC/USDT       78.50    -0.30%   $12M    [ Trade ▸ ]      │   │
│   └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│   ┌── Earn ──┐  ┌── Margin ──┐  ┌── OTC ──┐  ┌── P2P ──┐         │
│   │ Up to    │  │ Up to 10×  │  │ Block   │  │ Direct  │         │
│   │ 8% APY   │  │ leverage   │  │ liq.    │  │ peers   │         │
│   └──────────┘  └────────────┘  └─────────┘  └─────────┘         │
│                                                                    │
│ [Footer with banner + lab-safety reminder]                         │
└────────────────────────────────────────────────────────────────────┘
```

- TickerChyron at top (always visible)
- Hero copy + dual CTA
- "Top movers" table with live prices (clickable rows)
- Feature cards for Earn / Margin / OTC / P2P (link to those pages)
- Real footer with lab-safety reminder

## Hero surface 2 — Trading view (slice 4)

This is the page a serious trainee will spend the most time on.
It must feel like Binance Spot or Bybit. Three-column layout on
desktop, stacked on mobile.

```
┌────────────────────────────────────────────────────────────────────┐
│ Ticker chyron                                                       │
├──────────────────┬─────────────────────────────────┬───────────────┤
│  BTC/USDT  67,234.50  +1.23%  24h Hi 68,100  24h Lo 66,001  Vol 1.2B │
├──────────────────┴─────────────────────────────────┴───────────────┤
│ ORDER BOOK    │     CHART  [1m 5m 15m 1h 4h 1d]    │ PLACE ORDER  │
│ ┌─────────┐   │   ┌────────────────────────────┐   │┌────────────┐│
│ │ Price  Sz│   │   │  candles (lightweight-chts)│   ││ [BUY] SELL ││
│ │ 67,250  .. │   │   │                            │   ││            ││
│ │ 67,245  .. │   │   │     67,234.50              │   ││ Limit  Mkt ││
│ │ 67,240  .. │   │   │                            │   ││            ││
│ │--SPREAD-- │   │   │                            │   ││ Price  __  ││
│ │ 67,230  .. │   │   │                            │   ││ Amount __  ││
│ │ 67,225  .. │   │   │                            │   ││ Total  __  ││
│ └─────────┘   │   └────────────────────────────┘   ││            ││
│                │                                     ││ [25%][50%] ││
│ RECENT TRADES │   DEPTH CHART (small, below chart)  ││ [75%][MAX] ││
│ ┌─────────┐   │   ┌────────────────────────────┐   ││            ││
│ │ Px/Sz/T │   │   │ bid wall ←|→ ask wall      │   ││ Available: ││
│ └─────────┘   │   └────────────────────────────┘   ││ 0.42 BTC   ││
│                                                      ││ Buy BTC ▸  ││
├──────────────────────────────────────────────────────┴────────────┤
│ [Open Orders] [Order History] [Trade History] [Positions]         │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ table with virtualized rows                                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Key components:
- Top stat row: pair name, last, 24h%, 24h hi/lo/vol
- Left: order book (15 levels each side) + recent trades feed
- Center: candle chart via lightweight-charts, timeframe tabs,
  small depth chart below
- Right: order form
  - BIG side toggle Buy/Sell (60% green/40% red tabs)
  - Type tabs: Limit / Market / Stop-Limit / OCO
  - Price input (disabled for market)
  - Amount input
  - Total auto-calc'd
  - 25/50/75/MAX pills to size by % of balance
  - **`<BalancePill>` showing available before submit** — closes
    the staking complaint pattern application
  - Big colored "Buy BTC" / "Sell BTC" submit button
- Bottom: tabs for open orders / history / positions; uses
  `<DataTable>` with monospace cells

The page subscribes to four WS channels: `ticker:all`,
`book:BTC/USDT`, `trades:BTC/USDT`, `chart:BTC/USDT:5m`. Plus
`private:<userId>` for own-order updates.

URL: `/trade/BTC-USDT` (display) — internally converted to
`BTC/USDT` for the API. The slug bug F-1 fix landed; this
revamp preserves it.

## Hero surface 3 — Account dashboard / portfolio (slice 5)

The "home" page after login. Currently it's bare.

```
┌────────────────────────────────────────────────────────────────────┐
│ Welcome back, Ada                                       Tier 2  ⭐⭐ │
├────────────────────────────────────────────────────────────────────┤
│ ┌── Estimated balance ──┐  ┌── 24h P&L ───┐  ┌── Tier ──────────┐ │
│ │ $12,345.67            │  │ +$234.50     │  │ Tier 2 → Tier 3  │ │
│ │ 0.18 BTC equivalent   │  │ +1.94%       │  │ KYC required ▸   │ │
│ └───────────────────────┘  └──────────────┘  └──────────────────┘ │
├────────────────────────────────────────────────────────────────────┤
│ Equity curve (last 30d)                                            │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ smooth line chart, gradient fill                             │  │
│ └──────────────────────────────────────────────────────────────┘  │
├──────────────────────────┬─────────────────────────────────────────┤
│ Balances                  │ Recent activity                         │
│ ┌──────────────────────┐  │ ┌────────────────────────────────────┐ │
│ │ Asset   Free   Locked│  │ │ 12:34 Deposit  +0.5 BTC  confirmed │ │
│ │ BTC    0.42   0.10   │  │ │ 12:30 Trade    BTC/USDT  +0.01 BTC│ │
│ │ USDT  500.00  120.00 │  │ │ 12:20 Stake    -1.0 ETH           │ │
│ │ ETH    1.20    0.00  │  │ └────────────────────────────────────┘ │
│ └──────────────────────┘  │                                         │
├──────────────────────────┴─────────────────────────────────────────┤
│ Open orders (3)  ·  Open positions (1)  ·  Earn positions (2)      │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ side, pair, qty, price/mark, status; per-row action          │  │
│ └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

Key:
- Top stat cards (`<StatCard>` x3): total balance USD,
  24h P&L, tier status with progress to next tier
- Equity curve via lightweight-charts (derived from trade history
  snapshot, refreshed hourly server-side)
- Balances table: asset / free / locked / equivalent USD
- Recent activity feed: deposits, trades, withdrawals, stakes,
  claims — denormalized server-side
- Open orders / positions / earn-positions tabs

Server route: `GET /api/v2/me/dashboard` — returns aggregate
snapshot in a single round-trip. New endpoint.

## Hero surface 4 — Earn dashboard (slice 6) — FIXES THE COMPLAINT

The most urgent slice from the owner's specific frustration:
"in staking I don't even fucking know how much I have and how
much I can stake."

```
┌────────────────────────────────────────────────────────────────────┐
│ Earn                                  Lending  Staking  Liquidity   │
├────────────────────────────────────────────────────────────────────┤
│ ┌── Total earning ─────┐  ┌── Accrued ──────┐  ┌── Avg APY ───┐    │
│ │ $4,200.00            │  │ +$12.34         │  │ 5.2%         │    │
│ │ across 3 positions   │  │ unclaimed       │  │ weighted     │    │
│ └──────────────────────┘  └─────────────────┘  └──────────────┘    │
├────────────────────────────────────────────────────────────────────┤
│ STAKING                                                            │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Asset  APY   Available (spot)  Staked  Accrued  Action         │ │
│ │ ETH    4.0%  1.20 ETH          2.00    +0.0021   [Stake][Claim]│ │
│ │ LTC    3.0%  10.50 LTC         0       0         [Stake]       │ │
│ └────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────┤
│ LENDING                                                            │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Pool   APY    Util   Available (spot)  Supplied   Action       │ │
│ │ BTC    2.0%   45%    0.42 BTC          0.10 BTC   [Supply][↑]  │ │
│ │ USDT   3.5%   78%    500.00 USDT       0           [Supply]    │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

For EVERY action button, the BalancePill shows what's stakable /
suppliable RIGHT THERE. No more 403-with-no-context: the button
is disabled with a tooltip "KYC Tier 1 required" if the user
doesn't have it, with a one-click link to the KYC page.

The "Stake" modal:
```
┌── Stake ETH ──────────────────────────────────┐
│ Available: 1.20 ETH                            │
│                                                │
│ Amount: [_____________] ETH                    │
│ [25%] [50%] [75%] [MAX]                        │
│                                                │
│ APY: 4.0%   Estimated yearly: 0.048 ETH        │
│                                                │
│ [Cancel]               [Stake 1.20 ETH ▸]     │
└────────────────────────────────────────────────┘
```

Same pattern for Supply, Withdraw, Borrow, Repay, Claim.

The 403 issue specifically: trace WHY staking returns 403 today
and either fix the missing tier upgrade, OR show the tier-gate
disabled state PROACTIVELY before the user clicks. (Likely a
tier-1+ requirement that the lab's default seed user doesn't
have.)

## Sequencing (vertical slices)

Each slice is shippable in isolation. Owner sees progress after
each.

### Slice 0 — Triage + fix the urgent staking complaint **(1 day)**

Before the design system lands, fix the *information* problem:
- Investigate the 403 on staking. Document why.
- Show available balance on the current staking page (one
  small component, current styling).
- Disable buttons with helpful tooltip when tier-gated.
- Add a friendly "Tier 1 required" empty state with KYC link.

This is a tactical fix while the rest of the revamp goes through.

### Slice 1 — Design system foundation **(2-3 days)**

- Tailwind config + tokens
- IBM Plex Mono installed
- Root layout switches to dark theme baseline
- `apps/web/components/exchange/` library: TickerChyron stub,
  PriceCell, NumberCell, PercentChangeCell, StatCard,
  DataTable, BalancePill, SideToggle, Skeleton, EmptyState
- DO NOT DEPLOY banner restyled for dark mode
- Login + signup pages migrated to the new look (smallest
  surfaces; proof-of-concept)
- One screenshot per surface in `docs/phases/phase-10-revamp/
  screenshots/slice-1.png` (capture via Playwright)

### Slice 2 — Live mock feed + Markets page **(2-3 days)**

- `apps/worker/src/market-maker.ts` walks prices + writes trades
- 2 new market-maker seed users
- WS channels `ticker:all`, `chart:<pair>:<tf>`
- `/markets` page: data table of all pairs, live updates,
  click → trade
- TickerChyron wired up everywhere
- Tests for the price-walk math (no skew over N ticks)

### Slice 3 — Earn dashboard **(2-3 days)** — addresses the complaint

- `/earn` lands; sub-tabs Lending / Staking
- Each row shows: Asset / APY / Available (BalancePill) /
  Supplied or Staked / Accrued / action buttons
- Stake / Supply / Withdraw / Borrow / Repay / Claim modals
  use the new design with BalancePill + percentage pills
- Tier gating shown proactively, no 403 surprises
- The existing `/lending` and `/staking` pages redirect to
  `/earn?tab=...` for back-compat

### Slice 4 — Trading view **(4-5 days)** — the hero

- `/trade/:pair` (slug `BTC-USDT`, internally `BTC/USDT`)
- Three-column desktop layout + collapsible columns on mobile
- OrderBookSide, OrderBookSpread, RecentTradesFeed components
- lightweight-charts integration; candles from a new server
  endpoint `GET /api/v2/public/chart/:pair/:tf`
- Order form with side toggle, type tabs, percentage pills,
  BalancePill, big colored submit button
- Open orders / history / positions tabs at the bottom
- WS subscriptions for book + trades + ticker + private updates
- Empty states everywhere
- Loading skeletons everywhere

### Slice 5 — Account dashboard **(2-3 days)**

- `/account` (or `/portfolio`) lands
- Top stat cards (total balance, 24h P&L, tier progress)
- Equity curve via lightweight-charts
- Balances table, recent activity feed, open orders/positions/
  earn-positions tabs
- New server endpoint `GET /api/v2/me/dashboard`

### Slice 6 — Migrate remaining pages **(3-4 days)**

- Signup, login (already migrated in slice 1)
- KYC, deposit, withdraw, internal transfer
- OTC, P2P (consume new components)
- Admin, treasury, compliance, support, profile
- Each page goes through the design system; no functional
  behavior changes; planted V-NNN preserved

### Slice 7 — Polish + accessibility + mobile **(2-3 days)**

- Mobile responsive sweep (closes deferred QA P-5)
- a11y sweep: labels, aria, focus order on every page
- Reduce motion preference respected
- Final round of screenshots + visual diff against slice-1 baseline

**Total estimate: ~3 weeks of focused work**, but slices 0-3
land the bulk of the user-perceived improvement in the first
week.

## Risks and mitigations

- **R-1:** lightweight-charts adds ~50KB. Mitigation: lazy-load
  on /trade page only; landing and dashboards use a simpler
  Recharts/sparkline approach.
- **R-2:** Live mock feed could affect planted V-25 self-trade
  exploit (now there's "real" market noise). Mitigation: the
  self-trade *primitive* (no self-match filter) is unchanged; it
  just has competition. The CHAIN C demo arguably gets stronger
  because the manipulation has a baseline to deviate from.
- **R-3:** Migrating admin pages risks regression on V-1 stored
  XSS surface. Mitigation: explicit no-touch rule on
  `apps/web/app/admin/users/page.tsx` line that uses
  `dangerouslySetInnerHTML`. Audit after migration.
- **R-4:** Dark theme breaks the DO NOT DEPLOY banner contrast.
  Mitigation: redesigned banner uses pale-yellow `#F0B90B` on
  black — high contrast, present on every page.
- **R-5:** Mobile responsive sweep risks layout regressions on
  desktop. Mitigation: container queries where appropriate;
  visual diff against slice-1 screenshots after the mobile pass.

## Hard rules preserved from Phase 0

- DO NOT DEPLOY banner on every entry point
- No real Bitcoin / no mainnet / no real PII
- No outbound third-party calls (lightweight-charts is
  self-hosted, no CDN, no telemetry)
- All seed data synthetic
- `docker compose down -v` still destroys everything
- All 40 planted V-NNN preserved

## Exit criteria

When all 7 slices land:

1. Landing page has a live ticker chyron updating every 2s.
2. Trading view shows live book, live recent trades, live candle
   chart, and a serious order form with BalancePill front-and-center.
3. Earn page shows every asset's available, staked, accrued
   with clear numbers in monospace. No 403-with-no-context.
4. Account dashboard shows equity curve, balances, activity.
5. Every page is dark, Binance-flavored, dense, monospace numbers.
6. All 40 planted V-NNN still exploitable (regression-tested via
   running the existing chain PoCs).
7. `pnpm test` still passes (target ≥ 104).
8. `pnpm next build` still succeeds.
9. `docker compose up -d` brings up green, including the new
   market-maker worker.
10. Mobile (375×667) renders cleanly on the hero surfaces.

## Decisions ledger (locked 2026-05-29)

The owner ran 11 rounds of AskUserQuestion to lock the plan
before any code lands. The decisions:

### Visual identity
- **Aesthetic**: Binance / Bybit dark. Dense info, dark theme,
  yellow accent on black, red/green for sides, monospace numbers.
- **Logo mark**: yellow hexagon with a diagonal slash, paired
  with the Bitvulnex wordmark. Used in header, favicon, OG image.
- **Color tokens**: locked in the design-system section above
  (palette table). `#0B0E11` page bg, `#FCD535` Binance yellow,
  `#0ECB81` buy / `#F6465D` sell.
- **Typography**: Inter for UI, IBM Plex Mono for numbers
  (tabular nums, right-aligned for prices/qtys/percents).
- **Theme**: dark-only. No light mode toggle.
- **Motion**: subtle, fast (250ms PriceCell flash, 150ms toast
  slide, 200ms modal fade). Numeric digits don't animate.
  Respect `prefers-reduced-motion`.
- **Color-blind**: subtle ▲ / ▼ icons next to red/green text.
  No separate "colorblind palette" toggle in v1.

### Information architecture
- **URL structure**: aggressive consolidation. Top nav:
  Markets, Trade, Earn (lending+staking), Portfolio (balances+
  orders+positions+activity), Wallet (deposit+withdraw+transfer),
  More (OTC, P2P, API keys, Referrals, Subaccounts), Account
  (KYC, profile, security), Admin. Old routes 301-redirect.
- **Header layout**: Logo │ Markets Trade Earn Portfolio
  Wallet More │ Search │ Bell Avatar. Full Binance pattern.
- **Search**: pairs + popular destinations (command-bar style,
  Cmd+K or click input). Authenticated users get "My orders" /
  "My positions" shortcuts.
- **More menu contents**: OTC, P2P, API Keys, Referrals,
  Subaccounts (last two are convincing placeholders with seeded
  fake data).
- **Footer**: warning banner + sparse links (Docs, Changelog,
  Status, About).
- **Docs entry points**: `/docs` (Swagger), `/about/changelog`
  (diegetic hints), `/help` (Getting started, Account tiers,
  Trading basics, Lab specifics).

### Markets and data
- **Pair list (8)**: BTC/USDT, BTC/USDC, ETH/USDT, ETH/BTC,
  LTC/USDT, LTC/BTC, DOGE/USDT, USDC/USDT. Bitcoin-heavy.
  Thin-pair candidate for CHAIN C targeting: LTC/BTC or DOGE/USDT.
- **Live mock feed**: market-maker worker job, random-walk
  every 2s. Owner-confirmed cadence.
- **Charting**: `lightweight-charts` (Apache-2.0, ~50KB,
  TradingView open source, no CDN). Lazy-loaded on /trade only.
- **Order book**: 3-preset aggregation selector (e.g. 0.01 /
  0.1 / 1 for BTC; per-pair sensible defaults). 15 levels each
  side. Cumulative-size column not in v1.
- **Order types in UI**: Limit, Market, Stop-Limit, OCO — all
  four tabs visible. V-32 stop-loss / OCO race surface preserved.
- **Pre-trade confirm**: only when notional > 10% available OR
  leverage ≥ 5× OR market order > $1000. Three triggers.

### Number, time, locale
- **Numbers**: US convention, smart-precision. `1,234.56`.
  BTC up to 8dp, ETH up to 6dp, USDT to 2dp, trim trailing zeros.
  % 2dp with sign: `+1.23%` / `-0.45%`.
- **Time**: UTC everywhere, 24h, ISO-ish.
  `2026-05-29 14:23:01 UTC` in dense tables; `14:23` for
  chart axes.

### Per-page UX
- **Welcome onboarding**: dashboard sticky card with 5-step
  checklist (Verify email → Complete KYC → First deposit →
  First trade → Try Earn). Dismissable.
- **Demo seed**: new users get 0 balance. Use `/api/v2/dev/btc/*`
  affordances to self-seed. Realistic, V-42 surface preserved.
- **Deposit**: asset selector → network selector (BTC only) →
  QR code + address + warning + past-deposits table. Binance
  pattern.
- **Withdraw**: asset → address (saved or new) → amount + MAX
  pills + BalancePill → fee row → daily-limit bar → confirm
  modal.
- **KYC**: stepper (Personal info → ID upload → Address proof
  → Review). Save-as-you-go.
- **Margin position card**: pair, side pill, size, entry,
  mark, liq, P&L, leverage, action. Liq border pulses red
  within 5% of mark.
- **Tickets**: email-style threaded inbox + admin agent view.
  Markdown reply form (V-18 mXSS surface on admin side preserved).
- **Admin panel**: left sidebar + dense tables + right-side
  action drawers. Mirrors Linear / Notion admin / Stripe.
- **API keys**: full revamp — list, create modal with scope
  toggles, IP allowlist input, rotate, revoke.
- **Stub pages**: convincing placeholders with seeded data
  (Subaccounts empty + 'Coming soon'; Referrals 0 referrals,
  share link; Status green-dot service list with last incident;
  Bug Bounty rules + fake contact).

### State and session
- **localStorage UI state**: sticky preferences for chart
  timeframe, book aggregation, table column widths,
  sidebar collapsed-state, recent pair history. `bvbe.ui.*`
  namespace.
- **Equity curve**: server-computed daily snapshots, last 30d.
  New `EquitySnapshot` table + nightly job. Live tick prepended
  for today.
- **Session**: no auto-logout. JWT auto-refreshes every 15min
  via refresh token. V-21 refresh-replay surface preserved.

### Async feedback
- **Toasts**: `sonner` (~5KB). Top-right stack, 4s auto-dismiss,
  dense info, click to expand. Console errors surface as red.
- **Notifications bell**: trade events + announcements. Unread
  red dot. Mark-as-read persisted server-side.
- **WS reconnect**: subtle "Live / Reconnecting / Disconnected"
  pill in header. Cell skeletons on live data during reconnect.
  Exponential backoff.

### Activity log
- **Dashboard activity feed**: all money-touching events
  (deposits, withdrawals, internal transfers, every order
  placement/fill/cancel, every stake/unstake/claim, every
  margin open/close/liquidation, OTC, P2P). Newest first.
  Pagination at 50.

### Tone
- **Hero (landing) copy**: real-exchange marketing.
  *"Trade Bitcoin with institutional-grade infrastructure."*
- **In-app copy**: terse, monospace numbers, clinical.
  *"You bought 0.001 BTC at 67,234.50."*

### Workflow
- **Slice 0 first**: targeted staking 403 + balance-display
  fix lands TODAY before the design-system revamp begins.
- All other slices proceed in plan order (1 → 7).

### Outstanding (deferred to slice-time decisions)
- 2FA setup UX flow detail
- OTC desk UX revamp specifics
- P2P UX revamp specifics
- Help page section outline (beyond top-level: "Getting started",
  "Account tiers", "Trading basics", "Lab specifics")
- OG image art (will derive from hexagon-with-slash mark)
- Risk-warning modal on first margin trade
- Compliance / Treasury page revamp specifics

These get answered as their slice begins.
