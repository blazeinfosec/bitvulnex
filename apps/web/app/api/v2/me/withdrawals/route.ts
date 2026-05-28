import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import type { Tier } from "@/lib/kyc-tier";
import {
  InsufficientBalanceError,
  WithdrawalValidationError,
  submitWithdrawal,
} from "@/lib/withdrawal/submit";
import { LimitExceededError } from "@/lib/withdrawal/limit";
import { AssetError } from "@/lib/assets";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/withdrawals",
  summary: "Submit a withdrawal request",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / insufficient balance" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
    "429": { description: "Daily limit exceeded" },
  },
});

registerEndpoint({
  method: "get",
  path: "/api/v2/me/withdrawals",
  summary: "List the caller's withdrawals",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a positive decimal")
  .refine((s) => Number(s) > 0, "must be > 0");

const submitSchema = z.object({
  asset: z.string().min(1),
  amount: positiveDecimal,
  destAddress: z.string().min(1),
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
  const parsed = await readJson(req, submitSchema);
  if (parsed.error) return parsed.error;

  try {
    const out = await submitWithdrawal({
      userId: claims.sub,
      tier: claims.kycTier as Tier,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      destAddress: parsed.data.destAddress,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof WithdrawalValidationError)
      return jsonError(e.status, e.message);
    if (e instanceof InsufficientBalanceError)
      return jsonError(e.status, e.message);
    if (e instanceof LimitExceededError)
      return jsonError(e.status, e.message);
    if (e instanceof AssetError) return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "submit failed");
  }
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const rows = await prisma.withdrawal.findMany({
    where: { userId: claims.sub },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    withdrawals: rows.map((w) => ({
      ...w,
      amount: w.amount.toString(),
      fee: w.fee.toString(),
    })),
  });
}
