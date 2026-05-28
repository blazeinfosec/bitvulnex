// Claim staking rewards. The reward-accrual worker pre-materializes
// per-window `StakingClaim` rows; this endpoint sweeps the
// not-yet-claimed rows for the user's position and credits the
// reward asset to spot balance.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type ClaimArgs = {
  userId: string;
  positionId: string;
};

export type ClaimDb = Pick<
  typeof defaultPrisma,
  "balance" | "stakingPosition" | "stakingProgram" | "stakingClaim"
>;

export async function claimRewards(
  args: ClaimArgs,
  db: ClaimDb = defaultPrisma,
): Promise<{ credited: string; rows: number }> {
  const pos = await db.stakingPosition.findFirst({
    where: { id: args.positionId, userId: args.userId, status: "active" },
  });
  if (!pos) throw new Error("position not found");

  const program = await db.stakingProgram.findUnique({
    where: { asset: pos.asset },
  });
  if (!program) throw new Error("program not found");

  const unclaimed = await db.stakingClaim.findMany({
    where: { positionId: pos.id, claimedAt: null },
  });
  if (unclaimed.length === 0) {
    return { credited: "0", rows: 0 };
  }

  let total = new Prisma.Decimal(0);
  for (const c of unclaimed) {
    await db.stakingClaim.update({
      where: { id: c.id },
      data: { claimedAt: new Date() },
    });
    total = total.add(c.amount);
  }

  await db.balance.upsert({
    where: {
      userId_asset: { userId: args.userId, asset: program.rewardAsset },
    },
    update: {
      available: { increment: total },
      amount: { increment: total },
    },
    create: {
      userId: args.userId,
      asset: program.rewardAsset,
      available: total,
      amount: total,
    },
  });

  return { credited: total.toString(), rows: unclaimed.length };
}
