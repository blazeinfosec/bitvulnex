// List the caller's staking positions with unclaimed accrued rewards
// for each. Used by the Staking page to render position cards.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/staking/positions",
  summary: "List caller's staking positions with unclaimed accrued",
  responses: {
    "200": { description: "positions" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const positions = await prisma.stakingPosition.findMany({
    where: { userId: claims.sub, status: { in: ["active", "unstaking"] } },
    orderBy: { startedAt: "desc" },
  });

  const result = await Promise.all(
    positions.map(async (p) => {
      const unclaimed = await prisma.stakingClaim.aggregate({
        where: { positionId: p.id, claimedAt: null },
        _sum: { amount: true },
        _count: { id: true },
      });
      return {
        id: p.id,
        asset: p.asset,
        principal: p.principal.toString(),
        status: p.status,
        startedAt: p.startedAt,
        unstakedAt: p.unstakedAt,
        accrued: unclaimed._sum.amount?.toString() ?? "0",
        accruedWindows: unclaimed._count.id,
      };
    }),
  );

  return NextResponse.json({ positions: result });
}
