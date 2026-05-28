// Open a staking position. The staked principal moves OUT of the
// user's spot subtotal entirely (both `available` and `amount`).

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { requireKnownAsset } from "../assets";

export type StakeArgs = {
  userId: string;
  asset: string;
  amount: string;
};

export type StakeDb = Pick<
  typeof defaultPrisma,
  "balance" | "stakingProgram" | "stakingPosition" | "$transaction"
>;

export async function stake(
  args: StakeArgs,
  db: StakeDb = defaultPrisma,
): Promise<{ positionId: string }> {
  requireKnownAsset(args.asset);
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) throw new Error("amount must be > 0");

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const program = await tx.stakingProgram.findUnique({
      where: { asset: args.asset },
    });
    if (!program || !program.active) throw new Error("program not available");

    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: args.asset } },
    });
    if (!bal || bal.available.lt(amount)) {
      throw new Error("insufficient balance");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: args.asset } },
      data: {
        available: { decrement: amount },
        amount: { decrement: amount },
      },
    });

    const pos = await tx.stakingPosition.create({
      data: {
        userId: args.userId,
        asset: args.asset,
        principal: amount,
      },
    });
    return { positionId: pos.id };
  });
}
