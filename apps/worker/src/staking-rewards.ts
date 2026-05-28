// Staking reward materializer. For each active staking position,
// emit a StakingClaim row per completed window since the last claim
// row. The user-facing claim endpoint sweeps unclaimed rows and
// credits balance.

import { Prisma, prisma } from "@bvbe/db";
import { perSecondRate } from "@bvbe/shared";

const D = (s: string | number) => new Prisma.Decimal(s);

export type RewardDb = Pick<
  typeof prisma,
  "stakingProgram" | "stakingPosition" | "stakingClaim"
>;

export async function materializeStakingClaims(
  db: RewardDb = prisma,
): Promise<{ created: number }> {
  const programs = await db.stakingProgram.findMany({ where: { active: true } });
  const now = new Date();
  let created = 0;

  for (const program of programs) {
    const positions = await db.stakingPosition.findMany({
      where: { asset: program.asset, status: "active" },
    });
    const windowMs = program.windowSeconds * 1000;
    const ratePerSec = perSecondRate(program.apyBps);

    for (const pos of positions) {
      const lastClaim = await db.stakingClaim.findFirst({
        where: { positionId: pos.id },
        orderBy: { windowEnd: "desc" },
      });
      const baseline = lastClaim?.windowEnd ?? pos.startedAt;
      const elapsedMs = now.getTime() - baseline.getTime();
      const fullWindows = Math.floor(elapsedMs / windowMs);
      if (fullWindows <= 0) continue;

      for (let i = 0; i < fullWindows; i++) {
        const windowStart = new Date(baseline.getTime() + i * windowMs);
        const windowEnd = new Date(baseline.getTime() + (i + 1) * windowMs);
        const reward = pos.principal
          .mul(ratePerSec)
          .mul(program.windowSeconds);
        if (reward.lte(0)) continue;
        await db.stakingClaim.create({
          data: {
            positionId: pos.id,
            amount: reward,
            windowStart,
            windowEnd,
          },
        });
        created++;
      }
    }
  }

  return { created };
}
