# Phase 6 — Lending, staking, OTC desk, P2P

> Input to Gate 1. Phase 6 layers four product surfaces on top of the
> spot+margin stack: **lending pools** (supply/borrow with interest
> accrual), **staking** (rewards on PoS-style assets), an **OTC desk**
> for large-block tickets, and **P2P escrow** for off-book peer
> trades. Phase 6 plants three new vulns from the master catalog:
>
> - **V-44** (new V-NNN, master plan slot "interest-accrual rounding")
>   — sub-satoshi truncation in lending interest accrual lets a
>   sufficiently-active attacker harvest dust across many supply
>   ticks. Hard tier; chain D adjacent (information leak surface for
>   the lending pool reserves view).
> - **V-45** (master plan slot V-31, referral/promo replay applied to
>   staking reward claim) — staking reward claim endpoint is not
>   idempotent and races; a single-packet race can double-claim the
>   same reward window.
> - **V-46** (master plan slot "OTC privilege check via spoofable
>   header") — OTC desk endpoints gate privileged-trader features on
>   `x-bvbe-desk-role`, a header that nginx is supposed to strip but
>   doesn't.
>
> The carryover items from prior phases:
>
> - Phase-4 deferred Q-4.4 already closed in Phase 5. Q-5.8 carries:
>   the spot place-tests don't cover margin orchestrator paths; this
>   phase doesn't change that and the Phase-9 polish absorbs it.
> - Phase-5 L7 fix-up nit F-1 (transfer asset not pinned to registry)
>   does NOT close in Phase 6 — the asset surface expands here, so a
>   single pin lives at the schema-layer registry that Phase 6 adds.

## Goal

Make Bitvulnex feel like a full-featured CEX: users earn yield on idle
balances (lending + staking), do block-size trades off the public
order book (OTC), and trade peer-to-peer with the platform as escrow
(P2P). Real exchanges add these surfaces over time and they're
prolific sources of incidents: interest-accrual rounding flaws
(early Compound), OTC desk privilege creep, P2P dispute exploits.

## Deliverables

### Schema additions (additive only — no Phase 0-5 column changes)

```prisma
model LendingPool {
  id           String   @id @default(cuid())
  asset        String   @unique
  supplied     Decimal  @default(0) @db.Decimal(38, 8)   // total user-supplied
  borrowed     Decimal  @default(0) @db.Decimal(38, 8)   // total user-borrowed
  reserve      Decimal  @default(0) @db.Decimal(38, 8)   // platform reserve (interest spread accrues)
  apyBaseBps   Int                                       // base APY in bps (e.g. 200 = 2%)
  apySlopeBps  Int                                       // utilization slope in bps
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  lastAccrual  DateTime @default(now())

  @@map("lending_pools")
}

model LendingPosition {
  id            String         @id @default(cuid())
  userId        String
  pool          String         // asset symbol, FK on LendingPool.asset
  side          LendingSide    // supply or borrow
  principal     Decimal        @db.Decimal(38, 8)
  accrued       Decimal        @default(0) @db.Decimal(38, 8) // interest delta accumulated
  openedAt      DateTime       @default(now())
  closedAt      DateTime?
  status        LendingStatus  @default(open)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, pool])
  @@index([pool, status])
  @@map("lending_positions")
}

enum LendingSide  { supply  borrow }
enum LendingStatus { open  closed }

model StakingProgram {
  id            String   @id @default(cuid())
  asset         String   @unique   // staked asset, e.g. "ETH"
  rewardAsset   String              // reward asset (often same as asset)
  apyBps        Int                 // fixed APY in bps
  active        Boolean  @default(true)
  windowSeconds Int                 // claim window granularity, e.g. 3600
  createdAt     DateTime @default(now())

  @@map("staking_programs")
}

model StakingPosition {
  id           String        @id @default(cuid())
  userId       String
  asset        String
  principal    Decimal       @db.Decimal(38, 8)
  startedAt    DateTime      @default(now())
  unstakedAt   DateTime?
  status       StakingStatus @default(active)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  claims StakingClaim[]

  @@index([userId])
  @@index([asset, status])
  @@map("staking_positions")
}

model StakingClaim {
  id         String   @id @default(cuid())
  positionId String
  amount     Decimal  @db.Decimal(38, 8)
  windowStart DateTime
  windowEnd   DateTime
  claimedAt  DateTime @default(now())

  position StakingPosition @relation(fields: [positionId], references: [id], onDelete: Cascade)

  @@index([positionId])
  @@map("staking_claims")
}

enum StakingStatus { active unstaking ended }

model OtcTicket {
  id            String        @id @default(cuid())
  userId        String
  pair          String
  side          OrderSide
  amount        Decimal       @db.Decimal(38, 8)
  quotedPrice   Decimal?      @db.Decimal(38, 8)
  status        OtcStatus     @default(quoted)
  quoteExpiresAt DateTime?
  filledAt      DateTime?
  createdAt     DateTime      @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@map("otc_tickets")
}

enum OtcStatus { requested quoted accepted filled cancelled expired }

model P2POffer {
  id            String      @id @default(cuid())
  userId        String      // offer maker
  side          OrderSide   // buy / sell base asset for quote
  asset         String      // base asset
  amount        Decimal     @db.Decimal(38, 8)
  price         Decimal     @db.Decimal(38, 8)  // quote per base, off-book
  payMethod     String      // free-text e.g. "SEPA", "Zelle"
  status        P2PStatus   @default(open)
  createdAt     DateTime    @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  trades P2PTrade[]

  @@index([asset, status])
  @@map("p2p_offers")
}

model P2PTrade {
  id           String       @id @default(cuid())
  offerId      String
  buyerUserId  String
  sellerUserId String
  amount       Decimal      @db.Decimal(38, 8)
  price        Decimal      @db.Decimal(38, 8)
  status       P2PTradeStatus @default(pending_payment)
  createdAt    DateTime     @default(now())
  releasedAt   DateTime?
  disputedAt   DateTime?

  offer  P2POffer @relation(fields: [offerId], references: [id], onDelete: Restrict)
  buyer  User     @relation("p2p_buyer", fields: [buyerUserId], references: [id], onDelete: Cascade)
  seller User     @relation("p2p_seller", fields: [sellerUserId], references: [id], onDelete: Cascade)

  @@index([buyerUserId])
  @@index([sellerUserId])
  @@map("p2p_trades")
}

enum P2PStatus { open paused filled cancelled }
enum P2PTradeStatus { pending_payment paid released disputed cancelled }
```

`User` model gains the inverse relations only (no new columns). `Balance`
model unchanged — lending/staking interest credits hit `available`
directly via existing balance routines. **Per architect-review note
in Phase 5, the lending borrow side reuses `marginBorrowed` IS rejected
here** — lending and margin are separate sub-accounts conceptually and
their borrow exposure should not commingle. Lending exposure lives on
`LendingPosition` rows directly.

Migration `20260615000000_phase_6_yield_otc_p2p` is additive only.

### API surface

#### Lending
- `GET /api/v2/public/lending/pools` — list pools with current utilization & APY (cached at nginx).
- `POST /api/v2/me/lending/supply` — `{asset, amount}`. Locks balance.
- `POST /api/v2/me/lending/withdraw` — `{positionId}`. Releases supply + accrued.
- `POST /api/v2/me/lending/borrow` — `{asset, amount, collateralAsset, collateralAmount}`.
- `POST /api/v2/me/lending/repay` — `{positionId, amount}`. Partial allowed.
- `GET /api/v2/me/lending/positions` — caller's open positions.

#### Staking
- `GET /api/v2/public/staking/programs` — list active programs.
- `POST /api/v2/me/staking/stake` — `{asset, amount}`.
- `POST /api/v2/me/staking/unstake` — `{positionId}`.
- `POST /api/v2/me/staking/claim` — `{positionId}`. **V-45 plant.**

#### OTC desk
- `POST /api/v2/me/otc/quote` — `{pair, side, amount}` → returns quote
  with `quotedPrice` valid for `quoteExpiresAt`. Tier-2+ gate.
- `POST /api/v2/me/otc/accept` — `{ticketId}`. Executes against the
  internal OTC book at the quoted price. **V-46 plant** lives in
  the privileged "skip-fee" variant of accept: when the request
  carries `x-bvbe-desk-role: maker`, the OTC matcher applies a
  zero-fee path. nginx is supposed to strip this header but the
  reverse-proxy block for `/api/v2/me/otc/*` doesn't list it.

#### P2P
- `GET /api/v2/public/p2p/offers` — listings filtered by asset.
- `POST /api/v2/me/p2p/offers` — create offer (sell-side locks balance).
- `DELETE /api/v2/me/p2p/offers/:id` — cancel own offer.
- `POST /api/v2/me/p2p/trades` — take an offer → creates trade in
  `pending_payment`.
- `POST /api/v2/me/p2p/trades/:id/mark-paid` — buyer marks fiat paid.
- `POST /api/v2/me/p2p/trades/:id/release` — seller releases escrow
  to buyer.

### Worker — interest & reward accrual

`apps/worker/src/yield-accrual.ts`:
- BullMQ repeatable job; runs every 60s in regtest dev.
- For each `LendingPool`: compute time delta since `lastAccrual`,
  compute interest at `apyBaseBps + utilization*apySlopeBps`,
  distribute pro-rata across open `LendingPosition[side=supply]`
  rows, charge interest pro-rata to open `LendingPosition[side=borrow]`
  rows. **V-44 plant** lives here in the per-row distribution step:
  `principal * deltaSeconds * apyBps` is divided with
  `Prisma.Decimal.div(..., 0)` rounded-down (the default
  half-up→floor pattern Phase 4 had to fix), and the *remainder*
  goes into `LendingPool.reserve` rather than being held for the
  next tick. A high-frequency supply/withdraw pattern always rounds
  down to zero on small principals, so an attacker with many tiny
  positions can mathematically harvest the rounding boundary —
  except they can't, because the dust accrues to *reserve*. But the
  flaw inverts: on a tick where `pool.supplied == 0` but
  `pool.borrowed > 0`, all borrow interest goes 100% to reserve,
  and the next supply tick's accrued is computed from
  `principal * deltaSeconds * apyBps / supplied_at_t_minus_1` —
  the denominator off-by-one credits a fresh supplier with interest
  for the period *before* they supplied. Classic Compound-2020-flavor.

`apps/worker/src/staking-rewards.ts`:
- Similar BullMQ job, simpler math (flat APY, no utilization curve).
- Writes `StakingClaim` rows pre-emptively per window so the
  user-facing claim endpoint just marks them as claimed. The
  **V-45 race** lives where the user-facing claim endpoint reads
  unclaimed `StakingClaim` rows and credits the user's balance in
  a non-transactional `findMany → update[]` sequence.

### UI surface

- `/lending` — pool list + supply/borrow forms.
- `/staking` — program list + stake/claim UI.
- `/otc` — desk request form, quote display, accept button (Tier-2+ gated).
- `/p2p` — offer book, take-offer flow, trade detail page with
  payment-status buttons.
- Navigation: top-nav gains "Earn" dropdown (Lending, Staking) and
  "Trade" dropdown gains OTC + P2P submenu entries.

### Tests

- `packages/shared/src/yield-math.test.ts` — pure math: APY ↔ per-second
  rate conversion, utilization curve.
- `apps/worker/src/yield-accrual.test.ts` — DI seam, fake DB, four
  scenarios: empty pool, supply-only pool, supply+borrow pool,
  multi-tick conservation (sum of positions + reserve ≈ supplied principal
  + accrued total).
- `apps/web/lib/lending/supply.test.ts` — balance lock + position
  create; reject zero/negative amount.
- `apps/web/lib/staking/claim.test.ts` — happy path (single window
  claim); validation only — does NOT pin V-45 idempotency.
- `apps/web/lib/otc/quote.test.ts` — quote expiration logic.

## Open questions for the architect

1. **Interest accrual cadence.** The plan says 60s. Real protocols
   accrue per-block (every 12s on Ethereum) or per-second on demand.
   60s is a lab compromise: long enough for the tick to be observable
   in a CTF window, short enough that a 2-hour exercise sees multiple
   accrual cycles. Architect to confirm or veto.
2. **OTC "internal book" semantics.** OTC accepts execute against
   what? Options: (a) drain liquidity from the public order book in a
   single slippage-tolerant fill; (b) match against an opaque "desk
   inventory" pool seeded with imaginary liquidity. Plan defaults to
   (b) because (a) re-opens CHAIN C oracle questions. Architect picks.
3. **P2P escrow asset lock.** When a seller posts a P2P sell offer,
   does the platform lock the seller's spot balance immediately
   (offer-creation), or only when a buyer takes it (trade-creation)?
   Plan defaults to lock-on-create (Binance P2P shape). Architect picks.
4. **Staking unstake lockup.** Real PoS has 21-day unbonding. Plan
   defaults to "instant unstake, no lockup" for lab convenience.
   Architect to OK.
5. **Borrowing collateral ratio.** Plan defaults to 150% LTV (you
   supply 150 USDT collateral to borrow 100 USDT-equivalent of BTC).
   Liquidation when collateral value < 110% of borrow value. Phase 6
   does NOT wire this liquidation to the margin liquidation worker —
   it's a separate routine in `yield-accrual.ts`. Architect to OK.
6. **V-44 root-cause framing.** The description above mixes "rounding
   dust" (which is harmless because it accrues to reserve) and
   "off-by-one credit before supply" (which is the actual exploit).
   Architect should confirm we plant ONE flaw, not two, and pick the
   off-by-one as the planted one. Rounding dust is a real-world
   discipline gap but isn't easily exploitable in this shape.

## Exit criteria

1. `docker-compose down -v && docker-compose up` brings the stack up
   green. New Earn nav appears for any logged-in user.
2. A Tier-1 user can supply BTC to the lending pool, see it accrue
   interest after ~60s, and withdraw with the accrued amount in their
   spot balance.
3. A Tier-1 user can stake an asset (mock-ETH), see a `StakingClaim`
   row materialize after one tick, and claim it.
4. A Tier-2 user can request an OTC quote and accept it.
5. A user can post a P2P sell offer, another user can take it, mark
   it paid, and the seller can release.
6. `pnpm test` adds the yield-math and accrual tests; total at or
   above 60 tests.
7. Each planted vuln (V-44, V-45, V-46) has a working PoC in
   `docs/phases/phase-6/adversarial-qa.md`.

## Surfaces explicitly left clean

- `/api/v1/internal/*` — Phase 8.
- `lodash` / deep-merge gadgets — Phase 8.
- `child_process` / `exec` — Phase 8 (PDF export plant).
- Raw SQL via template literals — Phase 8.
- nginx CL/TE-tolerant directives — Phase 9.
- Treasury / withdrawal flow — Phase 7.
- Any new SSRF surface — Phase 8 if needed.

No vuln plant should leak into these surfaces from Phase 6's
lending/staking/OTC/P2P additions.
