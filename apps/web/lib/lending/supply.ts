// Supply liquidity to a lending pool. Locks the supplied principal
// out of the user's spot balance and into a LendingPosition row.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { requireKnownAsset } from "../assets";

export type SupplyArgs = {
  userId: string;
  asset: string;
  amount: string;
};

export type SupplyDb = Pick<
  typeof defaultPrisma,
  "balance" | "lendingPool" | "lendingPosition" | "$transaction"
>;

export async function supplyToPool(
  args: SupplyArgs,
  db: SupplyDb = defaultPrisma,
): Promise<{ positionId: string }> {
  requireKnownAsset(args.asset);
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) throw new Error("amount must be > 0");

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const pool = await tx.lendingPool.findUnique({
      where: { asset: args.asset },
    });
    if (!pool || !pool.active) throw new Error("pool not available");

    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: args.asset } },
    });
    if (!bal || bal.available.lt(amount)) {
      throw new Error("insufficient balance");
    }

    // Supplied principal moves OUT of the spot subtotal entirely:
    // both `available` and `amount` decrement. The spot subtotal
    // invariant (amount == available + locked) is preserved.
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: args.asset } },
      data: {
        available: { decrement: amount },
        amount: { decrement: amount },
      },
    });

    const position = await tx.lendingPosition.create({
      data: {
        userId: args.userId,
        pool: args.asset,
        side: "supply",
        principal: amount,
      },
    });

    await tx.lendingPool.update({
      where: { asset: args.asset },
      data: { supplied: { increment: amount } },
    });

    return { positionId: position.id };
  });
}
