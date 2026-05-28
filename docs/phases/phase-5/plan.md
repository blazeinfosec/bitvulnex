# Phase 5 — Margin trading & liquidation

> Input to Gate 1. Per the master plan, Phase 5 plants **no new
> margin-internal vulns** — the margin engine is built clean. CHAIN C
> completes here: V-25's self-trade primitive (already in place)
> manipulates the order-book mid, which the liquidation engine reads
> as oracle, cascading forced closures of other users' margin
> positions. The attacker registers as a keeper and captures the
> liquidation rebate. Phase-4 L7 deferrals (Q-4.4 `place.test.ts`,
> Q-4.11 WS rotation note) close in this commit too.

## Goal

Layer leveraged margin trading on top of Phase-4's spot engine.
Users open long/short positions backed by collateral; positions
get marked-to-market each block; when maintenance margin is
breached the liquidation engine flags the position and an external
keeper closes it for a rebate.

## Deliverables

### Schema additions (additive)

- Extend `Balance` with:
  - `marginAvailable Decimal(38,8)` — collateral free to open new positions
  - `marginBorrowed Decimal(38,8)` — outstanding borrow against open positions
- `MarginPosition`:
  - `id Int @id @default(autoincrement())`
  - `userId String`
  - `pair String`
  - `side` enum `long`/`short`
  - `size Decimal(38,8)` — quantity of base asset
  - `entryPrice Decimal(38,8)`
  - `leverage Int` — 2, 3, 5, or 10
  - `collateralAsset String` — typically "USDT"
  - `collateral Decimal(38,8)` — quote-asset collateral locked
  - `liquidationPrice Decimal(38,8)` — computed at open
  - `status` enum `open`/`liquidated`/`closed`
  - `openedAt`, `closedAt`, `closedPrice`, `realizedPnl`
- `Liquidation`:
  - `id Int @id @default(autoincrement())`
  - `positionId Int @unique`
  - `triggerPrice Decimal(38,8)`
  - `keeperUserId String?` — null until a keeper claims
  - `keeperRebate Decimal(38,8)`
  - `flaggedAt`, `claimedAt`
- Migration `20260601000000_phase_5_margin` (additive only — Phase-4
  spot Balance columns untouched).

### Engine — `apps/web/lib/engine/margin.ts`

Pure functions:

- `liquidationPriceFor(side, entryPrice, leverage, maintenanceMarginBps)`:
  formula for the price at which maintenance margin is breached.
- `pnlFor(position, markPrice)`: unrealized PnL given current mark.
- `breachesMaintenance(position, markPrice)`: bool.

### Liquidation worker — extends `apps/worker`

New BullMQ queue `liquidation-poll`, 2-second interval. On each
tick:

1. Read the public price feed `/api/v2/public/price/{pair}` for
   each active pair. (This is the **CHAIN C consumption point**:
   the price feed is exactly what V-25 self-trades manipulate.)
2. For each `MarginPosition` with `status: "open"`:
   - Compute `breachesMaintenance(position, markPrice)`.
   - If breached and no existing `Liquidation` row: insert one
     with `keeperUserId: null` (open for keeper claim).

The poll loop uses the same DI seam as the deposit watcher
(Phase-3 Q-3.2 pattern).

### Keeper system

Anyone (any tier-1+ user) can register as a keeper by hitting
`POST /api/v2/me/keeper/register`. Keepers see the open
liquidation queue and claim positions to close:

- `GET /api/v2/keeper/liquidations` — list open Liquidations
- `POST /api/v2/keeper/liquidations/[id]/claim` — atomically:
  - Lock the Liquidation row (set `keeperUserId`, `claimedAt`)
  - Close the position at the current mid (read from the same
    public price feed)
  - Credit the keeper's `Balance.available` with the rebate
    (= `collateral * KEEPER_REBATE_BPS / 10000`)
  - Mark position `liquidated`

The keeper rebate is taken from the closed position's collateral
(realistic: the platform doesn't fund liquidations).

### Place-order changes (for margin)

Margin orders go through the same matching engine as spot.
Distinction:

- `POST /api/v2/me/margin/positions` → opens a `MarginPosition`
  and places a market order via the existing `placeOrder` for the
  position size. The order's `feeTier` is the user's normal tier.
- Settlement: position records `entryPrice` from the average fill
  price (from the trades that filled the open). Collateral is
  locked from `Balance.marginAvailable`.

The matching engine itself is unchanged from Phase 4. Margin
positions just consume the same book.

### CHAIN C completion (this phase's exploit narrative)

The attacker's full chain end-to-end (documented in
`adversarial-qa.md`):

1. Attacker reaches tier 1 (legitimate signup + minimal KYC).
2. Attacker reaches tier 3 via V-35 middleware bypass on
   `/api/v2/admin/users` (Phase 1).
3. Tier-3 buys V-42 zero-conf BTC deposit (Phase 3) → inflated
   `Balance.available["BTC"]`.
4. Tier-3 places a sell limit at $50,000 BTC/USDT, then a matching
   buy from the same account → V-25 self-trade → `Trade` written
   at $50,000 → public price feed reports $50,000 as last.
5. Repeat to drive the price down to $40,000 (or up — depending
   on which side of victim positions the attacker wants to exploit).
6. Margin engine's `liquidation-poll` worker reads the manipulated
   price; victim's long position at $50,000 entry with 5× leverage
   has `liquidationPrice ≈ $45,000` — breached.
7. Worker flags the position; attacker (now also a registered
   keeper) hits `POST /api/v2/keeper/liquidations/{id}/claim`.
8. Position closes at the manipulated price; attacker captures
   the keeper rebate AND keeps the BTC they bought on the way
   down via the wash trades.
9. Public price feed un-manipulates as the order book restores;
   attacker is up the rebate + the rate spread minus fees.

The lab demonstrates the realistic Mt-Gox / FTX-flavor scenario:
external market manipulation triggers automated liquidations.

### Phase-4 L7 deferrals — closed in this commit

- **Q-4.4 (`place.test.ts` with DI seam):** Introduce
  `placeOrderWith(rpc, db, args)` overload (mirrors Phase-3 Q-3.2
  resolution). Tests assert balance-conservation invariants over
  representative (place, match, cancel) sequences. Does NOT pin
  V-25 self-trade behavior.
- **Q-4.11 (WS gateway token rotation):** Documented in
  `apps/ws-gateway/src/server.ts` with a forward-note comment; no
  code change in Phase 5 because no legit private channel yet
  carries side-effecting events. Phase 7 withdrawal alerts will
  trigger the rotation work.

### Tests

- `apps/web/lib/engine/margin.test.ts` — liquidation-price math,
  PnL formula, breach detection
- `apps/web/lib/engine/place.test.ts` — Phase-4 deferred:
  balance-conservation across place/match/cancel; rejects
  negative amounts; market-order refund correctness
- `apps/worker/src/liquidation-watcher.test.ts` — round-trip the
  poll loop with a fake db + a fake price feed

### UI

- `/account/margin` — open a long/short with leverage selector;
  see open positions with live PnL and liquidation price
- `/account/keeper` — register as keeper; see open liquidation
  queue; claim button per row
- `/account` updated with link to margin

### Diegetic CHANGELOG entry

"2026-06-01 — Phase 5: margin trading. Open long/short positions
with up to 10× leverage. Liquidations are triggered against the
order-book mid for each pair; **anyone can register as a keeper**
and claim liquidations for a 50bps rebate. PnL is settled at the
mark price at liquidation time."

The "anyone can register as a keeper" line is the diegetic hint:
on a real exchange this would be locked behind a vetting process.

## Vuln allocation

**No new V-NNN entries.** Phase 5 completes CHAIN C by giving
V-25's oracle manipulation a downstream consumer (the liquidation
engine). The chain's exploitability is V-25 + V-42 + V-35 (all
already planted) operating against the new margin surface. The
margin engine itself is built straight per architect direction.

## Exit criteria

1. All Phase 0–4 exit criteria still pass.
2. Tier-1+ user can open a long or short position via the UI.
3. PnL updates as the mark price moves.
4. When mark price crosses `liquidationPrice`, the worker flags a
   `Liquidation` within ~2 seconds.
5. A keeper can claim a flagged liquidation; the position closes;
   the keeper's `Balance.available` increases by the rebate.
6. CHAIN C end-to-end PoC documented in `adversarial-qa.md`.
7. Phase-4 deferred items closed (`place.test.ts` ships;
   ws-gateway rotation note added).
8. `surfaces to leave clean` grep returns zero hits for the
   still-reserved patterns.

## Open questions for the architect

1. **Margin orders use the same `placeOrder` shape, or a parallel
   `placeMarginOrder`?** Plan says reuse `placeOrder` and have the
   margin endpoint orchestrate the position-record creation around
   it. Simpler; one matching engine.
2. **Liquidation worker reads the price via `/api/v2/public/price`
   or directly from DB?** Plan says HTTP — this is exactly what
   makes CHAIN C land cleanly (the cached, manipulable price is
   the oracle). DB-direct would close the chain by accident.
3. **Should the keeper rebate come from the position's collateral
   or from a platform "insurance fund"?** Plan says collateral
   (realistic; the attacker can capture it directly).
4. **Leverage caps per tier?** Plan: tier 1 → 2×, tier 2 → 5×,
   tier 3 → 10×. Wired via the same `requireTier` helper. **String
   tier label** so V-27 has *another* reachable call site (still
   latent in this phase per architect direction; Phase 7 fires).
