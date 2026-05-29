import { NextResponse } from "next/server";
import { prisma, Prisma } from "@bvbe/db";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/markets",
  summary:
    "List of active trading pairs with 24h last/change/high/low/volume (cached 5s).",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

type MarketRow = {
  pair: string;
  base: string;
  quote: string;
  last: string | null;
  change24h: number;
  vol24h: string;
  high24h: string | null;
  low24h: string | null;
};

export async function GET() {
  const pairs = await prisma.tradingPair.findMany({
    where: { active: true },
    orderBy: [{ base: "asc" }, { quote: "asc" }],
  });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows: MarketRow[] = await Promise.all(
    pairs.map(async (tp): Promise<MarketRow> => {
      const pair = `${tp.base}/${tp.quote}`;
      const [last, first, trades] = await Promise.all([
        prisma.trade.findFirst({
          where: { pair },
          orderBy: { executedAt: "desc" },
          select: { price: true },
        }),
        prisma.trade.findFirst({
          where: { pair, executedAt: { gte: since } },
          orderBy: { executedAt: "asc" },
          select: { price: true },
        }),
        prisma.trade.findMany({
          where: { pair, executedAt: { gte: since } },
          select: { price: true, amount: true },
        }),
      ]);

      const lastStr = last?.price?.toString() ?? null;
      const firstNum = Number(first?.price?.toString() ?? lastStr ?? "0");
      const lastNum = Number(lastStr ?? "0");
      const change24h = firstNum > 0 ? ((lastNum - firstNum) / firstNum) * 100 : 0;

      let high: Prisma.Decimal | null = null;
      let low: Prisma.Decimal | null = null;
      let vol = new Prisma.Decimal(0);
      for (const t of trades) {
        if (!high || t.price.gt(high)) high = t.price;
        if (!low || t.price.lt(low)) low = t.price;
        vol = vol.add(t.price.mul(t.amount));
      }

      return {
        pair,
        base: tp.base,
        quote: tp.quote,
        last: lastStr,
        change24h,
        vol24h: vol.toString(),
        high24h: high?.toString() ?? null,
        low24h: low?.toString() ?? null,
      };
    }),
  );

  return NextResponse.json({ markets: rows });
}
