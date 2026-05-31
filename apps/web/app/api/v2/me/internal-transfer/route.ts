import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import {
  InsufficientBalanceError,
  TransferValidationError,
  internalTransfer,
} from "@/lib/withdrawal/internal-transfer";
import { AssetError } from "@/lib/assets";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/internal-transfer",
  summary: "Move funds to another Bitvulnex user (fee-free, off-chain)",
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
  .regex(/^\d+(\.\d+)?$/, "must be a positive decimal")
  .refine((s) => Number(s) > 0, "must be > 0");

const schema = z.object({
  recipientEmail: z.string().email(),
  asset: z.string().min(1),
  amount: positiveDecimal,
  memo: z.string().max(280).optional(),
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
    const out = await internalTransfer({
      fromUserId: claims.sub,
      toUserEmail: parsed.data.recipientEmail,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      memo: parsed.data.memo,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof TransferValidationError)
      return jsonError(e.status, e.message);
    if (e instanceof InsufficientBalanceError)
      return jsonError(e.status, e.message);
    if (e instanceof AssetError) return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "transfer failed");
  }
}
