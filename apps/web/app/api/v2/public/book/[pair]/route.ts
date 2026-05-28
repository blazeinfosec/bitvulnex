import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/book/{pair}",
  summary: "Top-20 bids and asks for a pair (cached 5s)",
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

  const [bids, asks] = await Promise.all([
    prisma.order.findMany({
      where: { pair, side: "buy", status: { in: ["open", "partial"] }, type: "limit" },
      orderBy: { price: "desc" },
      take: 20,
      select: { price: true, amount: true, filled: true },
    }),
    prisma.order.findMany({
      where: { pair, side: "sell", status: { in: ["open", "partial"] }, type: "limit" },
      orderBy: { price: "asc" },
      take: 20,
      select: { price: true, amount: true, filled: true },
    }),
  ]);

  const fmt = (rows: typeof bids) =>
    rows.map((r) => ({
      price: r.price?.toString() ?? null,
      remaining: r.amount.sub(r.filled).toString(),
    }));
  return NextResponse.json({ pair, bids: fmt(bids), asks: fmt(asks) });
}
