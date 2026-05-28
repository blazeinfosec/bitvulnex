import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { AssetError } from "@/lib/assets";
import { supplyToPool } from "@/lib/lending/supply";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/lending/supply",
  summary: "Supply liquidity to a lending pool",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / insufficient balance" },
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
  asset: z.string().min(1).max(16),
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
    const { positionId } = await supplyToPool({
      userId: claims.sub,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
    });
    return NextResponse.json({ positionId });
  } catch (e) {
    if (e instanceof AssetError) return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "supply failed");
  }
}
