// P2P offer book. Sell-side offers lock the seller's spot balance at
// offer-creation time (lock-on-create — architect resolution #3).
// Buy-side offers don't lock anything at creation; the locking
// happens on the matching seller when a trade is created.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { requireKnownAsset } from "../assets";

export type CreateOfferArgs = {
  userId: string;
  side: "buy" | "sell";
  asset: string;
  amount: string;
  price: string;
  payMethod: string;
};

export type OfferDb = Pick<
  typeof defaultPrisma,
  "balance" | "p2POffer" | "$transaction"
>;

export async function createOffer(
  args: CreateOfferArgs,
  db: OfferDb = defaultPrisma,
): Promise<{ offerId: string }> {
  requireKnownAsset(args.asset);
  const amount = new Prisma.Decimal(args.amount);
  const price = new Prisma.Decimal(args.price);
  if (amount.lte(0) || price.lte(0)) throw new Error("amount and price must be > 0");

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    if (args.side === "sell") {
      const bal = await tx.balance.findUnique({
        where: { userId_asset: { userId: args.userId, asset: args.asset } },
      });
      if (!bal || bal.available.lt(amount)) {
        throw new Error("insufficient balance to back sell offer");
      }
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: args.asset } },
        data: {
          available: { decrement: amount },
          locked: { increment: amount },
        },
      });
    }

    const offer = await tx.p2POffer.create({
      data: {
        userId: args.userId,
        side: args.side,
        asset: args.asset,
        amount,
        price,
        payMethod: args.payMethod,
      },
    });
    return { offerId: offer.id };
  });
}

export type CancelOfferArgs = {
  userId: string;
  offerId: string;
};

export async function cancelOffer(
  args: CancelOfferArgs,
  db: OfferDb = defaultPrisma,
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // Ownership filter is mandatory — Phase 6 architect condition #4
    // pins this as the clean surface; no IDOR here.
    const offer = await tx.p2POffer.findFirst({
      where: { id: args.offerId, userId: args.userId, status: "open" },
    });
    if (!offer) throw new Error("offer not found");

    if (offer.side === "sell") {
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: offer.asset } },
        data: {
          available: { increment: offer.amount },
          locked: { decrement: offer.amount },
        },
      });
    }
    await tx.p2POffer.update({
      where: { id: offer.id },
      data: { status: "cancelled" },
    });
  });
}
