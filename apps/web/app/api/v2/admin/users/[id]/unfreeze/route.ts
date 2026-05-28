// Unfreeze withdrawals for a user. Inverse of the freeze endpoint —
// writes an AdminAuditLog entry that the withdrawal submit path
// consults to determine the latest freeze/unfreeze state.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/users/{id}/unfreeze",
  summary: "Unfreeze withdrawals for a user",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

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
  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return jsonError(404, "not found");

  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "user_unfreeze",
      targetType: "user",
      targetId: id,
      metadata: {},
    },
  });

  return NextResponse.json({ ok: true });
}
