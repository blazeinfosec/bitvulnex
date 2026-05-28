import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { AssetError } from "@/lib/assets";
import { openBorrow } from "@/lib/lending/borrow";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/lending/borrow",
  summary: "Borrow against collateral from a lending pool",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / LTV / liquidity" },
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
  collateralAsset: z.string().min(1).max(16),
  collateralAmount: positiveDecimal,
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
    const { positionId } = await openBorrow({
      userId: claims.sub,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      collateralAsset: parsed.data.collateralAsset,
      collateralAmount: parsed.data.collateralAmount,
    });
    return NextResponse.json({ positionId });
  } catch (e) {
    if (e instanceof AssetError) return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "borrow failed");
  }
}
