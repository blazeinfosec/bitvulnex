import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/price/{pair}",
  summary: "Last trade price and best bid/ask for a pair (cached 5s)",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pair: string }> },
) {
  const { pair: raw } = await ctx.params;
  const pair = decodeURIComponent(raw);
  if (!/^[A-Z]+\/[A-Z]+$/.test(pair)) return jsonError(400, "bad pair");

  const [lastTrade, bestBid, bestAsk] = await Promise.all([
    prisma.trade.findFirst({
      where: { pair },
      orderBy: { executedAt: "desc" },
      select: { price: true, executedAt: true },
    }),
    prisma.order.findFirst({
      where: { pair, side: "buy", status: { in: ["open", "partial"] }, type: "limit" },
      orderBy: { price: "desc" },
      select: { price: true },
    }),
    prisma.order.findFirst({
      where: { pair, side: "sell", status: { in: ["open", "partial"] }, type: "limit" },
      orderBy: { price: "asc" },
      select: { price: true },
    }),
  ]);

  return NextResponse.json({
    pair,
    last: lastTrade?.price.toString() ?? null,
    lastAt: lastTrade?.executedAt ?? null,
    bestBid: bestBid?.price?.toString() ?? null,
    bestAsk: bestAsk?.price?.toString() ?? null,
  });
}
