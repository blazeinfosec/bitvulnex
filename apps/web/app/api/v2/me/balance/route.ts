import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/balance",
  summary: "Current balance per asset",
  responses: {
    "200": { description: "balances" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const balances = await prisma.balance.findMany({
    where: { userId: claims.sub },
    select: { asset: true, amount: true, updatedAt: true },
  });
  return NextResponse.json({
    balances: balances.map((b) => ({ ...b, amount: b.amount.toString() })),
  });
}
