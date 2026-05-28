import { NextResponse } from "next/server";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import {
  CancelValidationError,
  NotFoundError,
  cancelWithdrawal,
} from "@/lib/withdrawal/cancel";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/withdrawals/{id}/cancel",
  summary: "Cancel a pending withdrawal",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Withdrawal cannot be cancelled" },
    "401": { description: "Auth required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  try {
    const out = await cancelWithdrawal({ withdrawalId: id, userId: claims.sub });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof NotFoundError) return jsonError(e.status, e.message);
    if (e instanceof CancelValidationError)
      return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "cancel failed");
  }
}
