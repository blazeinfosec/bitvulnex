import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/withdrawals/{id}",
  summary: "Withdrawal detail",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  const w = await prisma.withdrawal.findFirst({
    where: { id, userId: claims.sub },
  });
  if (!w) return jsonError(404, "not found");
  return NextResponse.json({
    ...w,
    amount: w.amount.toString(),
    fee: w.fee.toString(),
  });
}
