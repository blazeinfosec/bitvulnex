// Instant unstake (no PoS unbonding window — see architect resolution
// #4). Returns principal to the spot balance.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type UnstakeArgs = {
  userId: string;
  positionId: string;
};

export type UnstakeDb = Pick<
  typeof defaultPrisma,
  "balance" | "stakingPosition" | "$transaction"
>;

export async function unstake(
  args: UnstakeArgs,
  db: UnstakeDb = defaultPrisma,
): Promise<{ released: string }> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const pos = await tx.stakingPosition.findFirst({
      where: {
        id: args.positionId,
        userId: args.userId,
        status: "active",
      },
    });
    if (!pos) throw new Error("position not found");

    await tx.stakingPosition.update({
      where: { id: pos.id },
      data: { status: "ended", unstakedAt: new Date() },
    });

    await tx.balance.upsert({
      where: { userId_asset: { userId: args.userId, asset: pos.asset } },
      update: {
        available: { increment: pos.principal },
        amount: { increment: pos.principal },
      },
      create: {
        userId: args.userId,
        asset: pos.asset,
        available: pos.principal,
        amount: pos.principal,
      },
    });

    return { released: pos.principal.toString() };
  });
}
