import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { AssetError } from "@/lib/assets";
import { createOffer } from "@/lib/p2p/offers";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/p2p/offers",
  summary: "Create a P2P offer (sell-side locks balance)",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / insufficient balance" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
  },
});

registerEndpoint({
  method: "get",
  path: "/api/v2/me/p2p/offers",
  summary: "List the caller's own P2P offers",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const rows = await prisma.p2POffer.findMany({
    where: { userId: claims.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    offers: rows.map((o) => ({
      id: o.id,
      side: o.side,
      asset: o.asset,
      amount: o.amount.toString(),
      price: o.price.toString(),
      payMethod: o.payMethod,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
    })),
  });
}

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((s) => Number(s) > 0);

const schema = z.object({
  side: z.enum(["buy", "sell"]),
  asset: z.string().min(1).max(16),
  amount: positiveDecimal,
  price: positiveDecimal,
  payMethod: z.string().min(1).max(64),
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
    const { offerId } = await createOffer({
      userId: claims.sub,
      side: parsed.data.side,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      price: parsed.data.price,
      payMethod: parsed.data.payMethod,
    });
    return NextResponse.json({ offerId });
  } catch (e) {
    if (e instanceof AssetError) return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "create offer failed");
  }
}
