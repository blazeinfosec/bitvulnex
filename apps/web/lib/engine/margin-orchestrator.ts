// Orchestrate margin position open/close.
//
// Phase 5 design call: margin positions are "synthetic" — collateral
// is locked from marginAvailable, the platform notionally borrows
// the remainder, and the position records the snapshot entry price
// from the book. No real spot trade fires when the position opens.
// Phase 6 architect to decide whether to wire `placeOrder` into the
// open path (would generate real Trade rows, amplifying CHAIN C
// reach but coupling margin to the spot order book).

import { Prisma, prisma } from "@bvbe/db";
import {
  liquidationPriceFor,
  unrealizedPnl,
  keeperRebate,
} from "./margin";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

export type OpenMarginArgs = {
  userId: string;
  pair: string;
  side: "long" | "short";
  size: string;
  leverage: number;
};

export async function openPosition(args: OpenMarginArgs): Promise<{
  positionId: number;
  entryPrice: string;
  liquidationPrice: string;
}> {
  const size = D(args.size);
  if (size.lte(0)) throw new Error("size must be > 0");
  if (![2, 3, 5, 10].includes(args.leverage)) {
    throw new Error("unsupported leverage");
  }
  const [base, quote] = args.pair.split("/");
  if (!base || !quote) throw new Error("bad pair");

  const pairRow = await prisma.tradingPair.findUnique({
    where: { base_quote: { base, quote } },
  });
  if (!pairRow?.active) throw new Error("unknown or inactive pair");

  // Estimate entry price from the current best ask (long) / bid (short).
  const bookSide = args.side === "long" ? "sell" : "buy";
  const estOrder = await prisma.order.findFirst({
    where: {
      pair: args.pair,
      side: bookSide,
      status: { in: ["open", "partial"] },
      type: "limit",
    },
    orderBy: { price: args.side === "long" ? "asc" : "desc" },
  });
  if (!estOrder?.price) throw new Error("insufficient liquidity");
  const estPrice = estOrder.price;

  // Collateral required = notional / leverage, denominated in quote.
  const notional = size.mul(estPrice);
  const collateral = notional.div(args.leverage);

  // Lock collateral from marginAvailable.
  const positionId = await prisma.$transaction(async (tx) => {
    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: quote } },
    });
    if (!bal || bal.marginAvailable.lt(collateral)) {
      throw new Error("insufficient margin available");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: quote } },
      data: {
        marginAvailable: { decrement: collateral },
        marginBorrowed: { increment: notional.sub(collateral) },
      },
    });

    const liqPrice = liquidationPriceFor(
      args.side,
      estPrice,
      size,
      collateral,
    );
    const pos = await tx.marginPosition.create({
      data: {
        userId: args.userId,
        pair: args.pair,
        side: args.side,
        size,
        entryPrice: estPrice,
        leverage: args.leverage,
        collateralAsset: quote,
        collateral,
        liquidationPrice: liqPrice,
      },
    });
    return pos.id;
  });

  const liqPrice = liquidationPriceFor(args.side, estPrice, size, collateral);
  return {
    positionId,
    entryPrice: estPrice.toString(),
    liquidationPrice: liqPrice.toString(),
  };
}

export async function closePosition(
  userId: string,
  positionId: number,
  closedPrice: Prisma.Decimal,
  keeperUserId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pos = await tx.marginPosition.findUnique({
      where: { id: positionId },
    });
    if (!pos || pos.status !== "open") throw new Error("position not open");
    if (!keeperUserId && pos.userId !== userId) throw new Error("forbidden");

    const pnl = unrealizedPnl(pos, closedPrice);
    const collateralReturn = pos.collateral.add(pnl);
    const notional = pos.size.mul(pos.entryPrice);
    const borrowed = notional.sub(pos.collateral);

    await tx.marginPosition.update({
      where: { id: positionId },
      data: {
        status: keeperUserId ? "liquidated" : "closed",
        closedAt: new Date(),
        closedPrice,
        realizedPnl: pnl,
      },
    });

    // Settle: release the borrow, return collateral + PnL minus any
    // keeper rebate.
    await tx.balance.update({
      where: {
        userId_asset: { userId: pos.userId, asset: pos.collateralAsset },
      },
      data: {
        marginBorrowed: { decrement: borrowed },
      },
    });

    if (keeperUserId) {
      const rebate = keeperRebate(pos.collateral);
      const userReturn = collateralReturn.sub(rebate);
      const safeReturn = userReturn.lt(0) ? D(0) : userReturn;
      await tx.balance.update({
        where: {
          userId_asset: { userId: pos.userId, asset: pos.collateralAsset },
        },
        data: { marginAvailable: { increment: safeReturn } },
      });
      await tx.balance.upsert({
        where: {
          userId_asset: { userId: keeperUserId, asset: pos.collateralAsset },
        },
        create: {
          userId: keeperUserId,
          asset: pos.collateralAsset,
          available: rebate,
          amount: rebate,
        },
        update: {
          available: { increment: rebate },
          amount: { increment: rebate },
        },
      });
    } else {
      // Self-close: full collateralReturn back to marginAvailable.
      const safeReturn = collateralReturn.lt(0) ? D(0) : collateralReturn;
      await tx.balance.update({
        where: {
          userId_asset: { userId: pos.userId, asset: pos.collateralAsset },
        },
        data: { marginAvailable: { increment: safeReturn } },
      });
    }
  });
}
