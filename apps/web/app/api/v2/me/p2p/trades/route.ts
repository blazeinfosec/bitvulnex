import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { createTrade } from "@/lib/p2p/trades";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/p2p/trades",
  summary: "Take a P2P offer and create a trade",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / offer not open" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
  },
});

registerEndpoint({
  method: "get",
  path: "/api/v2/me/p2p/trades",
  summary: "List the caller's P2P trades (as buyer or seller)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const rows = await prisma.p2PTrade.findMany({
    where: {
      OR: [{ buyerUserId: claims.sub }, { sellerUserId: claims.sub }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    trades: rows.map((t) => ({
      id: t.id,
      offerId: t.offerId,
      asset: t.asset,
      amount: t.amount.toString(),
      price: t.price.toString(),
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      releasedAt: t.releasedAt ? t.releasedAt.toISOString() : null,
      role: t.buyerUserId === claims.sub ? "buyer" : "seller",
    })),
  });
}

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((s) => Number(s) > 0);

const schema = z.object({
  offerId: z.string().min(1),
  amount: positiveDecimal,
});

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTier(claims, 1);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  try {
    const { tradeId } = await createTrade({
      takerUserId: claims.sub,
      offerId: parsed.data.offerId,
      amount: parsed.data.amount,
    });
    return NextResponse.json({ tradeId });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "create trade failed");
  }
}
