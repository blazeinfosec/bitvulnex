import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { repayBorrow } from "@/lib/lending/repay";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/lending/repay",
  summary: "Repay a borrow position (partial allowed)",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / position not found" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((s) => Number(s) > 0);

const schema = z.object({
  positionId: z.string().min(1),
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
    const { closed } = await repayBorrow({
      userId: claims.sub,
      positionId: parsed.data.positionId,
      amount: parsed.data.amount,
    });
    return NextResponse.json({ closed });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "repay failed");
  }
}
