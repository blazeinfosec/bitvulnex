import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { quoteOtc } from "@/lib/otc/quote";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/otc/quote",
  summary: "Request an OTC desk quote for a block trade",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / no reference price" },
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
  pair: z.string().regex(/^[A-Z]+\/[A-Z]+$/),
  side: z.enum(["buy", "sell"]),
  amount: positiveDecimal,
});

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTier(claims, 2);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  try {
    const q = await quoteOtc({
      userId: claims.sub,
      pair: parsed.data.pair,
      side: parsed.data.side,
      amount: parsed.data.amount,
    });
    return NextResponse.json(q);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "quote failed");
  }
}
