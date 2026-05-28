// Close a supply position: return principal + accrued interest to
// the user's spot balance.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type WithdrawArgs = {
  userId: string;
  positionId: string;
};

export type WithdrawDb = Pick<
  typeof defaultPrisma,
  "balance" | "lendingPool" | "lendingPosition" | "$transaction"
>;

export async function withdrawSupply(
  args: WithdrawArgs,
  db: WithdrawDb = defaultPrisma,
): Promise<{ credited: string }> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const pos = await tx.lendingPosition.findFirst({
      where: {
        id: args.positionId,
        userId: args.userId,
        side: "supply",
        status: "open",
      },
    });
    if (!pos) throw new Error("position not found");

    const credited = pos.principal.add(pos.accrued);

    await tx.lendingPosition.update({
      where: { id: pos.id },
      data: { status: "closed", closedAt: new Date() },
    });

    await tx.lendingPool.update({
      where: { asset: pos.pool },
      data: { supplied: { decrement: pos.principal } },
    });

    await tx.balance.upsert({
      where: { userId_asset: { userId: args.userId, asset: pos.pool } },
      update: {
        available: { increment: credited },
        amount: { increment: credited },
      },
      create: {
        userId: args.userId,
        asset: pos.pool,
        available: credited,
        amount: credited,
      },
    });

    return { credited: credited.toString() };
  });
}
