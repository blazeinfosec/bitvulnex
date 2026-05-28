// Fee-tier helpers. The lookup-by-30-day-volume aggregates the
// trades table directly; maker-side rows persist even after the
// originating order is cancelled because trade history is settlement
// truth.

import { Prisma, prisma } from "@bvbe/db";

export type FeeTier = "base" | "vip" | "prime";

export const FEE_TABLE: Record<FeeTier, { makerBps: number; takerBps: number }> = {
  base: { makerBps: 10, takerBps: 20 },
  vip: { makerBps: 5, takerBps: 10 },
  prime: { makerBps: 0, takerBps: 5 },
};

const TIER_THRESHOLD: Array<[FeeTier, Prisma.Decimal]> = [
  ["prime", new Prisma.Decimal(1_000_000)],
  ["vip", new Prisma.Decimal(50_000)],
  ["base", new Prisma.Decimal(0)],
];

export async function feeTierForUser(userId: string): Promise<FeeTier> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Sum the user's notional volume over the last 30 days.
  // Includes both maker and taker sides. We filter the takerOrder
  // side for cancellations (open/partial/filled/cancelled status)
  // -- but the maker side does NOT filter, since the maker order's
  // partial fills are real trades regardless of any later cancel
  // on the unfilled remainder.
  const rows = await prisma.trade.findMany({
    where: {
      OR: [{ takerUserId: userId }, { makerUserId: userId }],
      executedAt: { gte: since },
      takerOrder: { status: { not: "cancelled" } },
    },
    select: { amount: true, price: true },
  });
  let vol = new Prisma.Decimal(0);
  for (const t of rows) vol = vol.add(t.amount.mul(t.price));
  for (const [tier, threshold] of TIER_THRESHOLD) {
    if (vol.gte(threshold)) return tier;
  }
  return "base";
}
