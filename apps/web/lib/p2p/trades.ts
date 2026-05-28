// P2P trade lifecycle. A buyer "takes" an open sell offer (or a
// seller takes an open buy offer); the platform holds the seller's
// already-locked balance as escrow until release.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type CreateTradeArgs = {
  takerUserId: string;
  offerId: string;
  amount: string;
};

export type TradeDb = Pick<
  typeof defaultPrisma,
  "balance" | "p2POffer" | "p2PTrade" | "$transaction"
>;

export async function createTrade(
  args: CreateTradeArgs,
  db: TradeDb = defaultPrisma,
): Promise<{ tradeId: string }> {
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) throw new Error("amount must be > 0");

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const offer = await tx.p2POffer.findFirst({
      where: { id: args.offerId, status: "open" },
    });
    if (!offer) throw new Error("offer not open");
    if (offer.userId === args.takerUserId) {
      throw new Error("cannot take your own offer");
    }
    if (amount.gt(offer.amount)) throw new Error("amount exceeds offer");

    // For a sell-side offer, the maker is the seller and the taker is
    // the buyer. Reverse for a buy-side offer — taker locks balance.
    let buyerUserId: string;
    let sellerUserId: string;
    if (offer.side === "sell") {
      buyerUserId = args.takerUserId;
      sellerUserId = offer.userId;
      // Seller already locked at offer-creation. Nothing to add now.
    } else {
      buyerUserId = offer.userId;
      sellerUserId = args.takerUserId;
      // Taker is the seller — lock taker's balance now.
      const bal = await tx.balance.findUnique({
        where: { userId_asset: { userId: sellerUserId, asset: offer.asset } },
      });
      if (!bal || bal.available.lt(amount)) {
        throw new Error("insufficient balance to back trade");
      }
      await tx.balance.update({
        where: { userId_asset: { userId: sellerUserId, asset: offer.asset } },
        data: {
          available: { decrement: amount },
          locked: { increment: amount },
        },
      });
    }

    const trade = await tx.p2PTrade.create({
      data: {
        offerId: offer.id,
        buyerUserId,
        sellerUserId,
        amount,
        price: offer.price,
        asset: offer.asset,
      },
    });

    // If the taker consumed the full offer, mark it filled.
    if (amount.eq(offer.amount)) {
      await tx.p2POffer.update({
        where: { id: offer.id },
        data: { status: "filled" },
      });
    } else {
      await tx.p2POffer.update({
        where: { id: offer.id },
        data: { amount: offer.amount.sub(amount) },
      });
    }

    return { tradeId: trade.id };
  });
}

export type LifecycleArgs = {
  userId: string;
  tradeId: string;
};

export async function markPaid(
  args: LifecycleArgs,
  db: TradeDb = defaultPrisma,
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const trade = await tx.p2PTrade.findFirst({
      where: {
        id: args.tradeId,
        buyerUserId: args.userId,
        status: "pending_payment",
      },
    });
    if (!trade) throw new Error("trade not found");
    await tx.p2PTrade.update({
      where: { id: trade.id },
      data: { status: "paid" },
    });
  });
}

export async function release(
  args: LifecycleArgs,
  db: TradeDb = defaultPrisma,
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const trade = await tx.p2PTrade.findFirst({
      where: {
        id: args.tradeId,
        sellerUserId: args.userId,
        status: "paid",
      },
    });
    if (!trade) throw new Error("trade not found");

    // Seller's locked balance drops; buyer's available + amount rise.
    await tx.balance.update({
      where: {
        userId_asset: {
          userId: trade.sellerUserId,
          asset: trade.asset,
        },
      },
      data: {
        locked: { decrement: trade.amount },
        amount: { decrement: trade.amount },
      },
    });
    await tx.balance.upsert({
      where: {
        userId_asset: { userId: trade.buyerUserId, asset: trade.asset },
      },
      update: {
        available: { increment: trade.amount },
        amount: { increment: trade.amount },
      },
      create: {
        userId: trade.buyerUserId,
        asset: trade.asset,
        available: trade.amount,
        amount: trade.amount,
      },
    });

    await tx.p2PTrade.update({
      where: { id: trade.id },
      data: { status: "released", releasedAt: new Date() },
    });
  });
}
