// Open a borrow position against collateral. The 150% LTV is
// enforced at open time using the last-trade price from the public
// price surface. Lending liquidations are watched separately from
// margin liquidations (see worker/yield-accrual.ts).

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { requireKnownAsset } from "../assets";

export const LTV_BPS = 15_000; // 150%

export type BorrowArgs = {
  userId: string;
  asset: string;
  amount: string;
  collateralAsset: string;
  collateralAmount: string;
};

export type BorrowDb = Pick<
  typeof defaultPrisma,
  "balance" | "lendingPool" | "lendingPosition" | "trade" | "$transaction"
>;

async function priceOf(
  db: BorrowDb,
  base: string,
  quote: string,
): Promise<Prisma.Decimal | null> {
  if (base === quote) return new Prisma.Decimal(1);
  const t = await db.trade.findFirst({
    where: { pair: `${base}/${quote}` },
    orderBy: { executedAt: "desc" },
    select: { price: true },
  });
  if (t) return t.price;
  // Try inverse pair.
  const inv = await db.trade.findFirst({
    where: { pair: `${quote}/${base}` },
    orderBy: { executedAt: "desc" },
    select: { price: true },
  });
  if (inv && !inv.price.eq(0)) return new Prisma.Decimal(1).div(inv.price);
  return null;
}

export async function openBorrow(
  args: BorrowArgs,
  db: BorrowDb = defaultPrisma,
): Promise<{ positionId: string }> {
  requireKnownAsset(args.asset);
  requireKnownAsset(args.collateralAsset);
  const amount = new Prisma.Decimal(args.amount);
  const collateral = new Prisma.Decimal(args.collateralAmount);
  if (amount.lte(0)) throw new Error("amount must be > 0");
  if (collateral.lte(0)) throw new Error("collateral must be > 0");

  // Value both legs in a common quote (USDT) for LTV math.
  const borrowPx = await priceOf(db, args.asset, "USDT");
  const collPx = await priceOf(db, args.collateralAsset, "USDT");
  if (!borrowPx || !collPx) throw new Error("no price for ltv check");

  const borrowValue = amount.mul(borrowPx);
  const collateralValue = collateral.mul(collPx);
  const requiredCollateral = borrowValue.mul(LTV_BPS).div(10_000);
  if (collateralValue.lt(requiredCollateral)) {
    throw new Error("collateral below 150% LTV");
  }

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const pool = await tx.lendingPool.findUnique({
      where: { asset: args.asset },
    });
    if (!pool || !pool.active) throw new Error("pool not available");
    if (pool.supplied.sub(pool.borrowed).lt(amount)) {
      throw new Error("pool has insufficient liquidity");
    }

    // Lock the collateral out of the user's spot subtotal.
    const collBal = await tx.balance.findUnique({
      where: {
        userId_asset: { userId: args.userId, asset: args.collateralAsset },
      },
    });
    if (!collBal || collBal.available.lt(collateral)) {
      throw new Error("insufficient collateral balance");
    }
    await tx.balance.update({
      where: {
        userId_asset: { userId: args.userId, asset: args.collateralAsset },
      },
      data: {
        available: { decrement: collateral },
        amount: { decrement: collateral },
      },
    });

    // Credit the borrowed asset into the user's spot balance.
    await tx.balance.upsert({
      where: { userId_asset: { userId: args.userId, asset: args.asset } },
      update: {
        available: { increment: amount },
        amount: { increment: amount },
      },
      create: {
        userId: args.userId,
        asset: args.asset,
        available: amount,
        amount: amount,
      },
    });

    const position = await tx.lendingPosition.create({
      data: {
        userId: args.userId,
        pool: args.asset,
        side: "borrow",
        principal: amount,
        collateralAsset: args.collateralAsset,
        collateral,
      },
    });

    await tx.lendingPool.update({
      where: { asset: args.asset },
      data: { borrowed: { increment: amount } },
    });

    return { positionId: position.id };
  });
}
