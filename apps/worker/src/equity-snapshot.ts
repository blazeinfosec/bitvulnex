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
import {
  computeUserEquityUsd,
  type EquityInputMargin,
} from "@bvbe/shared";

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

  // Fetch the four input collections in parallel.
  const [balances, lending, stakes, positions] = await Promise.all([
    db.balance.findMany({
      where: { userId },
      select: { asset: true, amount: true, marginAvailable: true },
    }),
    db.lendingPosition.findMany({
      where: { userId, status: "open" },
      select: { pool: true, side: true, principal: true, accrued: true },
    }),
    db.stakingPosition.findMany({
      where: { userId, status: "active" },
      select: { asset: true, principal: true },
    }),
    db.marginPosition.findMany({
      where: { userId, status: "open" },
      select: {
        side: true,
        size: true,
        entryPrice: true,
        pair: true,
        collateral: true,
        collateralAsset: true,
      },
    }),
  ]);

  // Mark price per open margin pair.
  const markByPair = new Map<string, Prisma.Decimal | null>();
  for (const p of positions) {
    if (markByPair.has(p.pair)) continue;
    const t = await db.trade.findFirst({
      where: { pair: p.pair },
      orderBy: { executedAt: "desc" },
      select: { price: true },
    });
    markByPair.set(p.pair, t ? D(t.price) : null);
  }

  // Resolve all asset USD prices up-front so the pure helper has a
  // synchronous lookup (asset -> Decimal). Stablecoins are handled
  // inside priceCache.
  const usdAssets = new Set<string>();
  for (const b of balances) usdAssets.add(b.asset);
  for (const lp of lending) usdAssets.add(lp.pool);
  for (const sp of stakes) usdAssets.add(sp.asset);
  for (const p of positions) {
    usdAssets.add(p.collateralAsset);
    const quote = p.pair.split("/")[1];
    if (quote) usdAssets.add(quote);
  }
  const priceMap = new Map<string, Prisma.Decimal>();
  for (const asset of usdAssets) {
    priceMap.set(asset, await priceFor(asset));
  }

  const margin: EquityInputMargin[] = positions.map((p) => ({
    pair: p.pair,
    side: p.side,
    size: p.size,
    entryPrice: p.entryPrice,
    collateral: p.collateral,
    collateralAsset: p.collateralAsset,
    markPrice: markByPair.get(p.pair) ?? null,
  }));

  return computeUserEquityUsd({
    balances,
    lending,
    staking: stakes,
    margin,
    priceUsd: (asset) => priceMap.get(asset) ?? D("0"),
  });
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
