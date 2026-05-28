import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { withdrawSupply } from "@/lib/lending/withdraw";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/lending/withdraw",
  summary: "Close a supply position and return principal + accrued",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / position not found" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({ positionId: z.string().min(1) });

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
    const { credited } = await withdrawSupply({
      userId: claims.sub,
      positionId: parsed.data.positionId,
    });
    return NextResponse.json({ credited });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "withdraw failed");
  }
}
