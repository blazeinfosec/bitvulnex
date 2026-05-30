import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { ctfModeEnabled } from "@/lib/ctf";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/ctf/cohorts/{id}/reset",
  summary:
    "Drop all submissions, interactions, and hint reveals for a cohort",
  responses: { "200": { description: "Reset" } },
});

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || claims.role !== "admin") return jsonError(403, "forbidden");

  const { id } = await ctx.params;
  const [sub, inter, rev] = await prisma.$transaction([
    prisma.ctfSubmission.deleteMany({ where: { cohortId: id } }),
    prisma.ctfInteraction.deleteMany({ where: { cohortId: id } }),
    prisma.ctfHintReveal.deleteMany({ where: { cohortId: id } }),
  ]);

  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "ctf.cohort.reset",
      targetType: "cohort",
      targetId: id,
      metadata: {
        submissionsDeleted: sub.count,
        interactionsDeleted: inter.count,
        revealsDeleted: rev.count,
      },
    },
  });

  return NextResponse.json({
    submissionsDeleted: sub.count,
    interactionsDeleted: inter.count,
    revealsDeleted: rev.count,
  });
}
