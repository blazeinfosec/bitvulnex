// Liquidation watcher. Reads the public price feed for each active
// pair and flags MarginPosition rows whose maintenance margin is
// breached.
//
// Per architect direction (Phase-5 Gate-1 cond. #2): the price MUST
// come from the HTTP public-price endpoint, not directly from DB
// queries on Trade. The HTTP path is what V-25 self-trade
// manipulates; DB-direct would bypass CHAIN C.

import { Prisma, prisma } from "@bvbe/db";
import { breachesMaintenance, keeperRebate } from "@bvbe/shared";

const D = (s: string) => new Prisma.Decimal(s);

export type PriceClient = {
  getPrice(pair: string): Promise<{ last: string | null }>;
};

export type LiquidationDb = Pick<
  typeof prisma,
  "marginPosition" | "liquidation" | "tradingPair"
>;

export async function pollLiquidations(
  pricer: PriceClient,
  db: LiquidationDb = prisma,
): Promise<{ flagged: number }> {
  const pairs = await db.tradingPair.findMany({
    where: { active: true },
    select: { base: true, quote: true },
  });
  let flagged = 0;

  for (const tp of pairs) {
    const pair = `${tp.base}/${tp.quote}`;
    const { last } = await pricer.getPrice(pair).catch(() => ({ last: null }));
    if (!last) continue;
    const markPrice = D(last);

    const open = await db.marginPosition.findMany({
      where: { pair, status: "open" },
    });
    for (const pos of open) {
      const breach = breachesMaintenance(
        {
          side: pos.side,
          size: pos.size,
          entryPrice: pos.entryPrice,
          collateral: pos.collateral,
        },
        markPrice,
      );
      if (!breach) continue;
      const existing = await db.liquidation.findUnique({
        where: { positionId: pos.id },
      });
      if (existing) continue;
      await db.liquidation.create({
        data: {
          positionId: pos.id,
          triggerPrice: markPrice,
          keeperRebate: keeperRebate(pos.collateral),
        },
      });
      flagged += 1;
    }
  }

  return { flagged };
}
