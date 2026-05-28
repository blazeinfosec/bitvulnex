// Yield accrual worker. Runs every 60s; per-pool we compute the
// interest earned by borrowers over the elapsed window and distribute
// it pro-rata across the open supply positions. Borrowers pay
// pro-rata against their share of the pool's total borrow. Any
// residual settles into the pool reserve.

import { Prisma, prisma } from "@bvbe/db";
import { perSecondRate, utilization } from "@bvbe/shared";

const D = (s: string | number) => new Prisma.Decimal(s);

export type AccrualDb = Pick<
  typeof prisma,
  "lendingPool" | "lendingPosition"
>;

export async function accrueOnce(
  db: AccrualDb = prisma,
): Promise<{ pools: number }> {
  const pools = await db.lendingPool.findMany({ where: { active: true } });
  const now = new Date();
  let touched = 0;

  for (const pool of pools) {
    const deltaSeconds = Math.floor(
      (now.getTime() - pool.lastAccrual.getTime()) / 1000,
    );
    if (deltaSeconds < 1) continue;

    const u = utilization(pool.supplied, pool.borrowed);
    const cappedU = u.gt(1) ? D(1) : u;
    const effectiveBps = Math.round(
      pool.apyBaseBps + Number(cappedU.toString()) * pool.apySlopeBps,
    );
    const ratePerSec = perSecondRate(effectiveBps);
    const interest = pool.borrowed.mul(ratePerSec).mul(deltaSeconds);

    if (interest.lte(0)) {
      await db.lendingPool.update({
        where: { asset: pool.asset },
        data: { lastAccrual: now },
      });
      touched++;
      continue;
    }

    // Distribute interest across the open supply positions
    // proportionally to principal. The pool's current `supplied`
    // total is the denominator for the share calc.
    const supplyPositions = await db.lendingPosition.findMany({
      where: { pool: pool.asset, side: "supply", status: "open" },
    });
    let credited = D(0);
    if (pool.supplied.gt(0) && supplyPositions.length > 0) {
      for (const sp of supplyPositions) {
        const share = sp.principal.div(pool.supplied);
        const amt = interest.mul(share);
        if (amt.lte(0)) continue;
        await db.lendingPosition.update({
          where: { id: sp.id },
          data: { accrued: { increment: amt } },
        });
        credited = credited.add(amt);
      }
    }

    // Charge each open borrow position its proportional cost. The
    // sum across borrowers equals `interest` modulo rounding (the
    // remainder goes to reserve below).
    const borrowPositions = await db.lendingPosition.findMany({
      where: { pool: pool.asset, side: "borrow", status: "open" },
    });
    if (pool.borrowed.gt(0)) {
      for (const bp of borrowPositions) {
        const share = bp.principal.div(pool.borrowed);
        const amt = interest.mul(share);
        if (amt.lte(0)) continue;
        await db.lendingPosition.update({
          where: { id: bp.id },
          data: { accrued: { increment: amt } },
        });
      }
    }

    const residual = interest.sub(credited);
    await db.lendingPool.update({
      where: { asset: pool.asset },
      data: {
        reserve: { increment: residual.gt(0) ? residual : D(0) },
        lastAccrual: now,
      },
    });
    touched++;
  }

  return { pools: touched };
}
