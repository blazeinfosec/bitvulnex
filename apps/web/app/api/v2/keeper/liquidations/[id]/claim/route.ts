import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { closePosition } from "@/lib/engine/margin-orchestrator";

registerEndpoint({
  method: "post",
  path: "/api/v2/keeper/liquidations/{id}/claim",
  summary: "Claim a flagged liquidation; closes the position; rebate paid",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Already claimed or position no longer open" },
    "401": { description: "Auth required" },
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
  const liqId = Number(id);
  if (!Number.isInteger(liqId)) return jsonError(400, "bad id");

  // Atomic claim: SELECT ... WHERE keeperUserId IS NULL, then update.
  const claimed = await prisma.$transaction(async (tx) => {
    const liq = await tx.liquidation.findUnique({
      where: { id: liqId },
      include: { position: true },
    });
    if (!liq) throw new Error("not found");
    if (liq.keeperUserId) throw new Error("already claimed");
    if (liq.position.status !== "open") throw new Error("position not open");

    const updated = await tx.liquidation.update({
      where: { id: liqId },
      data: { keeperUserId: claims.sub, claimedAt: new Date() },
    });
    return { liq: updated, position: liq.position };
  }).catch((e) => ({ error: e instanceof Error ? e.message : "claim failed" }));

  if ("error" in claimed) return jsonError(400, claimed.error);

  // Close at the current mark price (same path margin-positions DELETE uses).
  const bookSide = claimed.position.side === "long" ? "buy" : "sell";
  const markOrder = await prisma.order.findFirst({
    where: {
      pair: claimed.position.pair,
      side: bookSide,
      status: { in: ["open", "partial"] },
      type: "limit",
    },
    orderBy: { price: claimed.position.side === "long" ? "desc" : "asc" },
  });
  const closedPrice = markOrder?.price ?? claimed.position.entryPrice;

  try {
    await closePosition(
      claimed.position.userId,
      claimed.position.id,
      closedPrice,
      claims.sub,
    );
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "settle failed");
  }
  return NextResponse.json({
    ok: true,
    closedPrice: closedPrice.toString(),
    rebate: claimed.liq.keeperRebate.toString(),
  });
}
