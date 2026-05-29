// Order detail + cancel handlers. The URL `id` is the orders table
// primary key; the route trusts that authenticated callers only
// reference their own orders from the UI.

import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { publishBookUpdate, publishUserUpdate } from "@/lib/engine/pubsub";
import { maybeEmitFlag } from "@/lib/ctf/emit";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const { id } = await ctx.params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0)
    return jsonError(400, "bad id");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return jsonError(404, "not found");

  const payload: Record<string, unknown> = {
    ...order,
    price: order.price?.toString() ?? null,
    amount: order.amount.toString(),
    filled: order.filled.toString(),
    stopTrigger: order.stopTrigger?.toString() ?? null,
  };
  // V-4: IDOR — the lookup above does not filter by userId, so this
  // handler returns orders the caller doesn't own. When CTF mode is
  // on, signal the exploit's success with a Pattern A `_flag`. The
  // plant's behavior is unchanged either way.
  const v4Fired = order.userId !== claims.sub;
  // V-22: mass-assign — a fee tier of "vip" or "prime" on a user's
  // order is evidence of a non-allowlisted FormData write through
  // editOrder, since legit place wires feeTier from the user's
  // volume-derived tier (and seeded users don't reach that volume).
  const v22Fired = order.feeTier === "prime" || order.feeTier === "vip";

  let out = payload as Record<string, unknown>;
  if (v4Fired) out = maybeEmitFlag(out, "V-4");
  if (v22Fired) out = maybeEmitFlag(out, "V-22");
  return NextResponse.json(out);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const { id } = await ctx.params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0)
    return jsonError(400, "bad id");

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
  // V-4 — DELETE IDOR. Same lookup-without-userId-filter as GET; same
  // signal. Plant behavior unchanged.
  const out =
    order.userId !== claims.sub
      ? maybeEmitFlag({ ok: true }, "V-4")
      : { ok: true };
  return NextResponse.json(out);
}
