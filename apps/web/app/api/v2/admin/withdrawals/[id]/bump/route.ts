import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { TierError, requireTreasury } from "@/lib/kyc-tier";
import {
  BumpValidationError,
  NotFoundError,
  bumpWithdrawalFee,
} from "@/lib/withdrawal/rbf";
import { maybeEmitFlag } from "@/lib/ctf/emit";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/withdrawals/{id}/bump",
  summary: "Replace a stuck withdrawal TX via RBF",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Withdrawal not bumpable" },
    "401": { description: "Auth required" },
    "403": { description: "Treasury role required" },
    "404": { description: "Withdrawal not found" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  newFeeSat: z.number().int().nonnegative(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTreasury(claims);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { id } = await ctx.params;
  try {
    const out = await bumpWithdrawalFee({
      withdrawalId: id,
      newFeeSat: parsed.data.newFeeSat,
      operatorUserId: claims.sub,
    });
    const body =
      Number(out.refundBtc) > 0 ? maybeEmitFlag(out, "V-47") : out;
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof NotFoundError) return jsonError(e.status, e.message);
    if (e instanceof BumpValidationError)
      return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "bump failed");
  }
}
