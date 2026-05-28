import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { closePosition } from "@/lib/engine/margin-orchestrator";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  const positionId = Number(id);
  if (!Number.isInteger(positionId)) return jsonError(400, "bad id");

  const pos = await prisma.marginPosition.findFirst({
    where: { id: positionId, userId: claims.sub },
  });
  if (!pos) return jsonError(404, "not found");
  if (pos.status !== "open") return jsonError(400, "not open");

  // Close at current mark = best bid for longs, best ask for shorts.
  const bookSide = pos.side === "long" ? "buy" : "sell";
  const markOrder = await prisma.order.findFirst({
    where: {
      pair: pos.pair,
      side: bookSide,
      status: { in: ["open", "partial"] },
      type: "limit",
    },
    orderBy: { price: pos.side === "long" ? "desc" : "asc" },
  });
  const closedPrice = markOrder?.price ?? pos.entryPrice;

  try {
    await closePosition(claims.sub, positionId, closedPrice, null);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "close failed");
  }
  return NextResponse.json({ ok: true, closedPrice: closedPrice.toString() });
}
