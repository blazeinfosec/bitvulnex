import { NextResponse } from "next/server";
import { prisma, Prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/chart/{pair}/{tf}",
  summary:
    "OHLC candles for a pair + timeframe. Aggregates Trade rows into time buckets; returns the most recent 200 candles. tf: 1m|5m|15m|1h|4h|1d.",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

const MAX_CANDLES = 200;

type Candle = {
  t: number; // bucket start (unix seconds)
  o: string;
  h: string;
  l: string;
  c: string;
  v: string; // base-asset volume
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pair: string; tf: string }> },
) {
  const { pair: rawPair, tf } = await ctx.params;
  const pair = decodeURIComponent(rawPair);
  if (!/^[A-Z]+\/[A-Z]+$/.test(pair)) return jsonError(400, "bad pair");
  const tfSeconds = TF_SECONDS[tf];
  if (!tfSeconds) return jsonError(400, "bad timeframe");

  const windowSeconds = tfSeconds * MAX_CANDLES;
  const since = new Date(Date.now() - windowSeconds * 1000);
  const trades = await prisma.trade.findMany({
    where: { pair, executedAt: { gte: since } },
    orderBy: { executedAt: "asc" },
    select: { price: true, amount: true, executedAt: true },
  });

  const buckets = new Map<number, Candle>();
  for (const t of trades) {
    const ts = Math.floor(t.executedAt.getTime() / 1000);
    const bucket = ts - (ts % tfSeconds);
    const priceStr = t.price.toString();
    const amtStr = t.amount.toString();
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        t: bucket,
        o: priceStr,
        h: priceStr,
        l: priceStr,
        c: priceStr,
        v: amtStr,
      });
    } else {
      existing.c = priceStr;
      if (t.price.gt(new Prisma.Decimal(existing.h))) existing.h = priceStr;
      if (t.price.lt(new Prisma.Decimal(existing.l))) existing.l = priceStr;
      existing.v = new Prisma.Decimal(existing.v).add(t.amount).toString();
    }
  }

  const candles = Array.from(buckets.values())
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_CANDLES);

  return NextResponse.json({ pair, tf, candles });
}
