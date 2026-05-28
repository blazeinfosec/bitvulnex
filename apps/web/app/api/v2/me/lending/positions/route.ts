import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/lending/positions",
  summary: "List the caller's open lending positions",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const positions = await prisma.lendingPosition.findMany({
    where: { userId: claims.sub, status: "open" },
    orderBy: { openedAt: "desc" },
  });
  return NextResponse.json({
    positions: positions.map((p) => ({
      id: p.id,
      pool: p.pool,
      side: p.side,
      principal: p.principal.toString(),
      accrued: p.accrued.toString(),
      collateralAsset: p.collateralAsset,
      collateral: p.collateral?.toString() ?? null,
      openedAt: p.openedAt,
    })),
  });
}
