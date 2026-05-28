import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/p2p/offers",
  summary: "Public P2P offer book (filter by ?asset=)",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset");
  const offers = await prisma.p2POffer.findMany({
    where: { status: "open", ...(asset ? { asset } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      side: true,
      asset: true,
      amount: true,
      price: true,
      payMethod: true,
      createdAt: true,
      user: { select: { displayName: true } },
    },
  });
  return NextResponse.json({
    offers: offers.map((o) => ({
      id: o.id,
      side: o.side,
      asset: o.asset,
      amount: o.amount.toString(),
      price: o.price.toString(),
      payMethod: o.payMethod,
      maker: o.user?.displayName ?? null,
      createdAt: o.createdAt,
    })),
  });
}
