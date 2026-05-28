// Place-order orchestrator. Locks balance, runs the engine, writes
// trades, broadcasts WS updates. Single transaction.

import { Prisma, prisma } from "@bvbe/db";
import {
  matchAgainstBook,
  sortBook,
  type IncomingOrder,
  type RestingOrder,
} from "./match";
import { FEE_TABLE, type FeeTier } from "./fees";
import { publishBookUpdate, publishTrade, publishUserUpdate } from "./pubsub";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

type PlaceArgs = {
  userId: string;
  pair: string; // "BTC/USDT"
  side: "buy" | "sell";
  type: "limit" | "market" | "stop_limit" | "oco";
  price?: string;
  amount: string;
  stopTrigger?: string;
  feeTier: FeeTier;
};

export async function placeOrder(args: PlaceArgs): Promise<{ orderId: number }> {
  const amount = D(args.amount);
  const price = args.price ? D(args.price) : null;
  const [base, quote] = args.pair.split("/");
  if (!base || !quote) throw new Error("bad pair");

  // Asset we lock at placement time depends on side
  const lockAsset = args.side === "buy" ? quote : base;
  const lockQty =
    args.side === "buy"
      ? // For a buy: lock quote = price * amount (limit) or
        // conservative estimate for market (best-ask * amount approx)
        // For market we lock amount * lastTradePrice as a stand-in.
        (price ?? D(await bestPriceEstimate(args.pair, "ask"))).mul(amount)
      : amount;

  const orderId = await prisma.$transaction(async (tx) => {
    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: lockAsset } },
    });
    if (!bal || bal.available.lt(lockQty)) {
      throw new Error("insufficient balance");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: lockAsset } },
      data: {
        available: { decrement: lockQty },
        locked: { increment: lockQty },
      },
    });

    const order = await tx.order.create({
      data: {
        userId: args.userId,
        pair: args.pair,
        side: args.side,
        type: args.type,
        price,
        amount,
        stopTrigger: args.stopTrigger ? D(args.stopTrigger) : null,
        feeTier: args.feeTier,
      },
    });

    // Pull the resting book (opposite side, status open/partial).
    const restingRaw = await tx.order.findMany({
      where: {
        pair: args.pair,
        side: args.side === "buy" ? "sell" : "buy",
        status: { in: ["open", "partial"] },
        type: { in: ["limit"] }, // only limit orders rest in the book
      },
      take: 200,
    });
    const resting: RestingOrder[] = restingRaw.map((r) => ({
      id: r.id,
      userId: r.userId,
      side: r.side,
      type: r.type,
      price: r.price,
      amount: r.amount,
      filled: r.filled,
    }));

    const taker: IncomingOrder = {
      side: args.side,
      type: args.type,
      price,
      amount,
      userId: args.userId,
    };
    const sorted = sortBook(resting, args.side);
    const { matches, remaining } = matchAgainstBook(taker, sorted);

    // Apply matches: write trades, settle balances, update maker orders
    let filled = D(0);
    for (const m of matches) {
      filled = filled.add(m.amount);
      const makerFeeBps = FEE_TABLE[args.feeTier].makerBps;
      const takerFeeBps = FEE_TABLE[args.feeTier].takerBps;

      await tx.trade.create({
        data: {
          pair: args.pair,
          takerOrderId: order.id,
          makerOrderId: m.makerOrderId,
          takerUserId: args.userId,
          makerUserId: m.makerUserId,
          price: m.price,
          amount: m.amount,
          takerFeeBps,
          makerFeeBps,
        },
      });

      // Settle: move locked → away, credit counter-asset
      // Taker
      const takerLockRelease = args.side === "buy"
        ? m.price.mul(m.amount)
        : m.amount;
      const takerCredit = args.side === "buy" ? m.amount : m.price.mul(m.amount);
      const takerCreditAsset = args.side === "buy" ? base : quote;
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: lockAsset } },
        data: { locked: { decrement: takerLockRelease } },
      });
      await upsertBalance(tx, args.userId, takerCreditAsset, takerCredit);

      // Maker — opposite asset flow
      const makerOrder = restingRaw.find((r) => r.id === m.makerOrderId)!;
      const makerLockAsset = makerOrder.side === "buy" ? quote : base;
      const makerLockRelease = makerOrder.side === "buy"
        ? m.price.mul(m.amount)
        : m.amount;
      const makerCredit = makerOrder.side === "buy" ? m.amount : m.price.mul(m.amount);
      const makerCreditAsset = makerOrder.side === "buy" ? base : quote;
      await tx.balance.update({
        where: { userId_asset: { userId: makerOrder.userId, asset: makerLockAsset } },
        data: { locked: { decrement: makerLockRelease } },
      });
      await upsertBalance(tx, makerOrder.userId, makerCreditAsset, makerCredit);

      // Update maker order filled/status
      const newFilled = makerOrder.filled.add(m.amount);
      const newStatus =
        newFilled.gte(makerOrder.amount) ? "filled" : "partial";
      await tx.order.update({
        where: { id: makerOrder.id },
        data: { filled: newFilled, status: newStatus },
      });
    }

    // Update taker order filled/status
    const takerStatus =
      filled.gte(amount) ? "filled" : filled.gt(0) ? "partial" : "open";
    await tx.order.update({
      where: { id: order.id },
      data: { filled, status: takerStatus },
    });

    // For market orders that didn't fully fill, refund the over-locked amount
    if (args.type === "market" && remaining.gt(0)) {
      const refund =
        args.side === "buy"
          ? lockQty.sub(filled.mul(price ?? D(0)))
          : remaining;
      if (refund.gt(0)) {
        await tx.balance.update({
          where: { userId_asset: { userId: args.userId, asset: lockAsset } },
          data: {
            available: { increment: refund },
            locked: { decrement: refund },
          },
        });
      }
    }

    return order.id;
  });

  // Fire-and-forget WS broadcasts (outside the tx)
  publishBookUpdate(args.pair).catch(() => {});
  publishUserUpdate(args.userId).catch(() => {});

  return { orderId };
}

async function upsertBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  asset: string,
  delta: Prisma.Decimal,
): Promise<void> {
  await tx.balance.upsert({
    where: { userId_asset: { userId, asset } },
    create: { userId, asset, amount: delta, available: delta },
    update: { available: { increment: delta }, amount: { increment: delta } },
  });
}

async function bestPriceEstimate(pair: string, side: "bid" | "ask"): Promise<string> {
  const o = await prisma.order.findFirst({
    where: {
      pair,
      side: side === "ask" ? "sell" : "buy",
      status: { in: ["open", "partial"] },
      type: "limit",
    },
    orderBy: { price: side === "ask" ? "asc" : "desc" },
  });
  return (o?.price ?? new Prisma.Decimal(0)).toString();
}
