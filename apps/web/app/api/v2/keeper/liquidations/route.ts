import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/keeper/liquidations",
  summary: "Open liquidation queue (claim a row to close the position)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const open = await prisma.liquidation.findMany({
    where: { keeperUserId: null, position: { status: "open" } },
    orderBy: { flaggedAt: "asc" },
    include: {
      position: {
        select: {
          id: true,
          pair: true,
          side: true,
          size: true,
          entryPrice: true,
          collateral: true,
          liquidationPrice: true,
        },
      },
    },
  });
  return NextResponse.json({
    liquidations: open.map((l) => ({
      id: l.id,
      triggerPrice: l.triggerPrice.toString(),
      keeperRebate: l.keeperRebate.toString(),
      flaggedAt: l.flaggedAt,
      position: {
        id: l.position.id,
        pair: l.position.pair,
        side: l.position.side,
        size: l.position.size.toString(),
        entryPrice: l.position.entryPrice.toString(),
        collateral: l.position.collateral.toString(),
        liquidationPrice: l.position.liquidationPrice.toString(),
      },
    })),
  });
}
