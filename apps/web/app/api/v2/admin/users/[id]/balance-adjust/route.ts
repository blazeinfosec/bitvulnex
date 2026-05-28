// Manual balance adjustment for support / treasury reconciliations.
// Writes an AdminAuditLog row alongside the balance change so the
// adjustment is recoverable on review.

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

const schema = z.object({
  asset: z.string().min(1),
  delta: z.string().min(1),
  note: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { asset, delta, note } = parsed.data;
  const { id: targetUserId } = await ctx.params;

  let deltaDec: Prisma.Decimal;
  try {
    deltaDec = new Prisma.Decimal(delta);
  } catch {
    return jsonError(400, "invalid delta");
  }
  if (deltaDec.eq(0)) {
    return jsonError(400, "delta must be non-zero");
  }

  await prisma.$transaction(async (tx) => {
    await tx.balance.upsert({
      where: { userId_asset: { userId: targetUserId, asset } },
      update: {
        amount: { increment: deltaDec },
        available: { increment: deltaDec },
      },
      create: {
        userId: targetUserId,
        asset,
        amount: deltaDec,
        available: deltaDec,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorUserId: claims.sub,
        action: "balance_adjust",
        targetType: "user",
        targetId: targetUserId,
        metadata: {
          asset,
          delta: deltaDec.toString(),
          note: note ?? null,
        },
      },
    });
  });

  return NextResponse.json({ ok: true });
}
