// V-4 IDOR site: order GET + DELETE handlers look up by URL `id`
// without verifying the order belongs to the authenticated user.

import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { publishBookUpdate, publishUserUpdate } from "@/lib/engine/pubsub";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const { id } = await ctx.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return jsonError(400, "bad id");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return jsonError(404, "not found");

  return NextResponse.json({
    ...order,
    price: order.price?.toString() ?? null,
    amount: order.amount.toString(),
    filled: order.filled.toString(),
    stopTrigger: order.stopTrigger?.toString() ?? null,
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const { id } = await ctx.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return jsonError(400, "bad id");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return jsonError(404, "not found");
  if (order.status === "filled" || order.status === "cancelled") {
    return jsonError(400, "order cannot be cancelled");
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "cancelled", cancelledAt: new Date() },
    });

    // Refund the unfilled remainder
    const [base, quote] = order.pair.split("/");
    if (!base || !quote) return;
    const lockAsset = order.side === "buy" ? quote : base;
    const remaining = order.amount.sub(order.filled);
    const refund =
      order.side === "buy"
        ? (order.price ?? new Prisma.Decimal(0)).mul(remaining)
        : remaining;
    if (refund.gt(0)) {
      await tx.balance.update({
        where: { userId_asset: { userId: order.userId, asset: lockAsset } },
        data: {
          available: { increment: refund },
          locked: { decrement: refund },
        },
      });
    }
  });

  publishBookUpdate(order.pair).catch(() => {});
  publishUserUpdate(order.userId).catch(() => {});
  return NextResponse.json({ ok: true });
}
