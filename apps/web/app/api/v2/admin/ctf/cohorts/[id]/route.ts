import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { ctfModeEnabled } from "@/lib/ctf";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "patch",
  path: "/api/v2/admin/ctf/cohorts/{id}",
  summary: "Edit cohort settings (hints default, unlock window, archive)",
  responses: { "200": { description: "Updated" } },
});

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  hintsDefault: z.boolean().optional(),
  verboseUnlockSeconds: z.number().int().min(0).max(3600).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || claims.role !== "admin") return jsonError(403, "forbidden");

  const { id } = await ctx.params;
  const parsed = await readJson(req, patchSchema);
  if (parsed.error) return parsed.error;

  const data: Record<string, unknown> = {};
  if (parsed.data.hintsDefault !== undefined)
    data.hintsDefault = parsed.data.hintsDefault;
  if (parsed.data.verboseUnlockSeconds !== undefined)
    data.verboseUnlockSeconds = parsed.data.verboseUnlockSeconds;
  if (parsed.data.archived !== undefined) {
    data.archivedAt = parsed.data.archived ? new Date() : null;
  }

  const cohort = await prisma.cohort.update({
    where: { id },
    data,
  });

  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "ctf.cohort.update",
      targetType: "cohort",
      targetId: id,
      metadata: parsed.data,
    },
  });

  return NextResponse.json(cohort);
}
