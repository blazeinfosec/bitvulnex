// Resolve / dismiss a compliance case. Writes resolution metadata
// to the case row and an AdminAuditLog entry for the action trail.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  notes: z.string().optional(),
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
  const { id } = await ctx.params;
  const c = await prisma.complianceCase.findUnique({ where: { id } });
  if (!c) return jsonError(404, "not found");

  const updated = await prisma.complianceCase.update({
    where: { id },
    data: {
      status: parsed.data.status,
      notes: parsed.data.notes ?? c.notes,
      resolvedAt: new Date(),
    },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: `compliance_${parsed.data.status}`,
      targetType: "compliance_case",
      targetId: id,
      metadata: {},
    },
  });
  return NextResponse.json({ case: updated });
}
