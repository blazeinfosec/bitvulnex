// Equity-snapshot worker. For each user, computes a USD-equivalent
// total of their account at the moment of the tick and upserts a row
// into `equity_snapshots` keyed by (userId, UTC date). The dashboard
// `/api/v2/me/dashboard` then reads the last 30 days to draw the
// equity curve and to compute 24h P&L.
//
// Composition of `totalUsd`:
//   - Spot balances: `amount` (which is available + locked) per asset
//   - Margin sub-account: `marginAvailable` per asset (collateral that
//     hasn't been borrowed away). NOTE: `marginBorrowed` is NOT user-
//     owned and is excluded.
//   - Lending positions: principal + accrued for both supply and
//     borrow sides. Borrow positions reduce equity (debt).
//   - Staking positions: principal (rewards accumulate into spot
//     balance via the staking-rewards worker, so no double-count).
//   - Margin positions: collateral + unrealized P&L. P&L =
//     size * (markPrice - entryPrice) for long, inverse for short.
//     The collateral has already moved out of marginAvailable into
//     the position, so we add it back here.
//
// Lab cadence: 5 minutes instead of nightly so demos see the curve
// move. Real exchanges typically snapshot end-of-day UTC.

import { Prisma, prisma } from "@bvbe/db";

const D = (s: string | number | Prisma.Decimal) => new Prisma.Decimal(s);

export type EquitySnapshotDb = Pick<
  typeof prisma,
  | "user"
  | "balance"
  | "trade"
  | "lendingPosition"
  | "stakingPosition"
  | "marginPosition"
  | "equitySnapshot"
>;

// Maps an asset to its USD-equivalent price by looking at the most
// recent <ASSET>/USDT trade. Stablecoins (USDT, USDC) pegged to 1.00.
// Returns 0 for assets with no derivable price — those are treated as
// zero-USD contributors rather than throwing so a single missing pair
// doesn't blow up the whole snapshot run.
async function priceCache(db: EquitySnapshotDb) {
  const cache = new Map<string, Prisma.Decimal>();
  cache.set("USDT", D("1"));
  cache.set("USDC", D("1"));

  async function priceFor(asset: string): Promise<Prisma.Decimal> {
    const hit = cache.get(asset);
    if (hit) return hit;
    const pair = `${asset}/USDT`;
    const t = await db.trade.findFirst({
      where: { pair },
      orderBy: { executedAt: "desc" },
      select: { price: true },
    });
    const p = t ? D(t.price) : D("0");
    cache.set(asset, p);
    return p;
  }

  return { priceFor };
}

/** Start-of-UTC-day for the given date. Mutates a new Date. */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function computeUserEquity(
  userId: string,
  db: EquitySnapshotDb,
): Promise<Prisma.Decimal> {
  const { priceFor } = await priceCache(db);
  let total = D("0");

  // Spot + margin sub-account
  const balances = await db.balance.findMany({
    where: { userId },
    select: {
      asset: true,
      amount: true,
      marginAvailable: true,
    },
  });
  for (const b of balances) {
    const px = await priceFor(b.asset);
    if (px.lte(0)) continue;
    total = total.add(D(b.amount).mul(px));
    total = total.add(D(b.marginAvailable).mul(px));
  }

  // Lending positions: supply credits, borrow debits
  const lending = await db.lendingPosition.findMany({
    where: { userId, status: "open" },
    select: { pool: true, side: true, principal: true, accrued: true },
  });
  for (const lp of lending) {
    const px = await priceFor(lp.pool);
    if (px.lte(0)) continue;
    const value = D(lp.principal).add(D(lp.accrued)).mul(px);
    total = lp.side === "supply" ? total.add(value) : total.sub(value);
  }

  // Staking positions — principal sits inside the staking sub-account.
  // Rewards have already been credited to Balance.available by the
  // staking-rewards worker so they're counted via the balance loop.
  const stakes = await db.stakingPosition.findMany({
    where: { userId, status: "active" },
    select: { asset: true, principal: true },
  });
  for (const sp of stakes) {
    const px = await priceFor(sp.asset);
    if (px.lte(0)) continue;
    total = total.add(D(sp.principal).mul(px));
  }

  // Margin positions — re-add collateral (which left marginAvailable
  // when the position opened) and the unrealized P&L on the position.
  const positions = await db.marginPosition.findMany({
    where: { userId, status: "open" },
    select: {
      side: true,
      size: true,
      entryPrice: true,
      pair: true,
      collateral: true,
      collateralAsset: true,
    },
  });
  for (const p of positions) {
    // Re-add the collateral (which lives in the position, not in
    // marginAvailable).
    const collPx = await priceFor(p.collateralAsset);
    if (collPx.gt(0)) {
      total = total.add(D(p.collateral).mul(collPx));
    }
    // Mark price from the latest trade on the pair.
    const lastTrade = await db.trade.findFirst({
      where: { pair: p.pair },
      orderBy: { executedAt: "desc" },
      select: { price: true },
    });
    if (!lastTrade) continue;
    const mark = D(lastTrade.price);
    const entry = D(p.entryPrice);
    const size = D(p.size);
    const diff = p.side === "long" ? mark.sub(entry) : entry.sub(mark);
    // P&L is denominated in the quote asset of the pair; for
    // `BTC/USDT` etc. that's USD-equivalent already. For exotic pairs
    // we approximate by converting via the quote's USD price.
    const quote = p.pair.split("/")[1] ?? "USDT";
    const quotePx = await priceFor(quote);
    if (quotePx.lte(0)) continue;
    total = total.add(size.mul(diff).mul(quotePx));
  }

  return total;
}

export async function snapshotOnce(
  db: EquitySnapshotDb = prisma,
  now: Date = new Date(),
): Promise<{ users: number }> {
  const day = startOfUtcDay(now);
  const users = await db.user.findMany({ select: { id: true } });
  let touched = 0;
  for (const u of users) {
    const total = await computeUserEquity(u.id, db);
    await db.equitySnapshot.upsert({
      where: { userId_date: { userId: u.id, date: day } },
      create: {
        userId: u.id,
        date: day,
        totalUsd: total,
      },
      update: {
        totalUsd: total,
        computedAt: now,
      },
    });
    touched++;
  }
  return { users: touched };
}
