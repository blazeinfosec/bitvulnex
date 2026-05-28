import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/deposits",
  summary: "List the caller's deposits",
  responses: {
    "200": { description: "deposits" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const deposits = await prisma.deposit.findMany({
    where: { userId: claims.sub },
    orderBy: { seenAt: "desc" },
    take: 100,
    select: {
      id: true,
      asset: true,
      address: true,
      txid: true,
      vout: true,
      amount: true,
      confirmations: true,
      status: true,
      seenAt: true,
      creditedAt: true,
    },
  });
  return NextResponse.json({
    deposits: deposits.map((d) => ({ ...d, amount: d.amount.toString() })),
  });
}
