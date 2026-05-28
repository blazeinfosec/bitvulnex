import { NextResponse } from "next/server";
import { z } from "zod";
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

export const dynamic = "force-dynamic";

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
