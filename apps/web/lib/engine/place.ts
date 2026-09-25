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

type ExecutedTrade = {
  id: number;
  price: string;
  amount: string;
  executedAt: Date;
};

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
  // Defense-in-depth: the route's zod schema already rejects
  // non-positive operands, but placeOrder is also called from
  // tests and engine code where the schema is bypassed.
  if (amount.lte(0)) throw new Error("amount must be > 0");
  if (price && price.lte(0)) throw new Error("price must be > 0");
  const [base, quote] = args.pair.split("/");
  if (!base || !quote) throw new Error("bad pair");

  // Reject orders against pairs the platform doesn't actually trade.
  // Phase-4 L7 Q-4.6 fix.
  const pairRow = await prisma.tradingPair.findUnique({
    where: { base_quote: { base, quote } },
  });
  if (!pairRow?.active) throw new Error("unknown or inactive pair");

  // Asset we lock at placement time depends on side: buy locks quote,
  // sell locks base.
  const lockAsset = args.side === "buy" ? quote : base;

  const result = await prisma.$transaction(async (tx) => {
    // Pull the resting book (opposite side, open/partial limit orders)
    // up front so we can size the balance lock against the actual fills
    // rather than a best-price estimate.
    const restingRaw = await tx.order.findMany({
      where: {
        pair: args.pair,
        side: args.side === "buy" ? "sell" : "buy",
        status: { in: ["open", "partial"] },
        type: { in: ["limit"] }, // only limit orders rest in the book
      },
      // Best price first, then time priority within a level, so the
      // `take` window always holds the top of the book.
      orderBy: [
        { price: args.side === "buy" ? "asc" : "desc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
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

    // Aggregate fill totals so we can lock the exact quote cost of a
    // market buy and compute price-improvement refunds for limit buys.
    let filled = D(0);
    let actualQuoteSpent = D(0);
    for (const m of matches) {
      filled = filled.add(m.amount);
      actualQuoteSpent = actualQuoteSpent.add(m.price.mul(m.amount));
    }

    // A market order that can't fill anything has no book to execute
    // against (Q-4.10).
    if (args.type === "market" && filled.lte(0)) {
      throw new Error("insufficient liquidity");
    }

    // How much to reserve. A market buy reserves exactly the swept cost
    // (it never rests, and sweeping several price levels can cost more
    // than best-ask * amount). A limit buy reserves the full limit
    // notional so an unfilled remainder can rest in the book. Sells
    // lock the base amount.
    let lockQty: Prisma.Decimal;
    if (args.side === "sell") {
      lockQty = amount;
    } else if (args.type === "market") {
      lockQty = actualQuoteSpent;
    } else {
      if (!price) throw new Error("price required for non-market order");
      lockQty = price.mul(amount);
    }

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

    // Apply matches: write trades, settle balances, update maker orders.
    const executed: ExecutedTrade[] = [];
    for (const m of matches) {
      const makerOrder = restingRaw.find((r) => r.id === m.makerOrderId)!;
      const makerFeeBps = (FEE_TABLE[makerOrder.feeTier as FeeTier] ?? FEE_TABLE.base).makerBps;
      const takerFeeBps = FEE_TABLE[args.feeTier].takerBps;

      const trade = await tx.trade.create({
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
      executed.push({
        id: trade.id,
        price: m.price.toString(),
        amount: m.amount.toString(),
        executedAt: trade.executedAt,
      });

      // Settle: move locked → away, credit counter-asset net of fee.
      // Each side pays its bps fee on the asset it receives (standard
      // maker/taker model); the fee is skimmed off the credit.
      // Taker
      const takerLockRelease = args.side === "buy"
        ? m.price.mul(m.amount)
        : m.amount;
      const takerGross = args.side === "buy" ? m.amount : m.price.mul(m.amount);
      const takerCredit = takerGross.sub(
        takerGross.mul(takerFeeBps).div(10000),
      );
      const takerCreditAsset = args.side === "buy" ? base : quote;
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: lockAsset } },
        data: {
          locked: { decrement: takerLockRelease },
          amount: { decrement: takerLockRelease },
        },
      });
      await upsertBalance(tx, args.userId, takerCreditAsset, takerCredit);

      // Maker — opposite asset flow
      const makerLockAsset = makerOrder.side === "buy" ? quote : base;
      const makerLockRelease = makerOrder.side === "buy"
        ? m.price.mul(m.amount)
        : m.amount;
      const makerGross = makerOrder.side === "buy" ? m.amount : m.price.mul(m.amount);
      const makerCredit = makerGross.sub(
        makerGross.mul(makerFeeBps).div(10000),
      );
      const makerCreditAsset = makerOrder.side === "buy" ? base : quote;
      await tx.balance.update({
        where: { userId_asset: { userId: makerOrder.userId, asset: makerLockAsset } },
        data: {
          locked: { decrement: makerLockRelease },
          amount: { decrement: makerLockRelease },
        },
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

    // Update taker order filled/status. A market order never rests, so
    // whatever it couldn't fill is cancelled rather than left `partial`
    // (which would keep it listed among open orders forever).
    const takerStatus = filled.gte(amount)
      ? "filled"
      : args.type === "market"
        ? "cancelled"
        : filled.gt(0)
          ? "partial"
          : "open";
    await tx.order.update({
      where: { id: order.id },
      data: { filled, status: takerStatus },
    });

    // Release any over-lock back to available. The match loop already
    // decremented `locked` by each fill's actual cost, so what remains
    // locked is `lockQty - (base sold | quote spent)`. Two cases leave
    // more locked than the order needs:
    //  - a limit buy filled at a better price than its limit: the
    //    price-improvement delta (limit*filled - actualQuoteSpent) on
    //    the filled portion would otherwise stay locked forever;
    //  - a market sell that didn't fully fill: the leftover base
    //    (`remaining`) must be returned since a market order never rests.
    // A market buy is locked at its exact cost, and a limit order's
    // unfilled remainder must stay locked to back the resting order.
    let releaseQty = D(0);
    if (args.side === "buy" && args.type !== "market" && price) {
      releaseQty = price.mul(filled).sub(actualQuoteSpent);
    } else if (args.side === "sell" && args.type === "market") {
      releaseQty = remaining;
    }
    if (releaseQty.gt(0)) {
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: lockAsset } },
        data: {
          available: { increment: releaseQty },
          locked: { decrement: releaseQty },
        },
      });
    }

    return { id: order.id, executed };
  });

  // Fire-and-forget WS broadcasts (outside the tx)
  for (const t of result.executed) {
    publishTrade(args.pair, t, args.side).catch(() => {});
  }
  publishBookUpdate(args.pair).catch(() => {});
  publishUserUpdate(args.userId).catch(() => {});

  return { orderId: result.id };
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
