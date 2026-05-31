import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { ctfModeEnabled, flagFor } from "@/lib/ctf";
import { derivableFlag, expectedSecretFor, flagPrefix } from "@/lib/ctf/derive";
import { isKnownTarget } from "@/lib/ctf/catalog";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/ctf/cohorts/{id}/reveal-flag",
  summary:
    "Instructor unlock — credit a specific trainee with a specific target's flag (audit-logged)",
  responses: { "200": { description: "Revealed" } },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  userId: z.string().min(1),
  targetKey: z.string().min(1).max(20),
  reason: z.string().min(1).max(500),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || claims.role !== "admin") return jsonError(403, "forbidden");

  const { id: cohortId } = await ctx.params;
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  if (!isKnownTarget(parsed.data.targetKey))
    return jsonError(400, "unknown targetKey");

  const expected =
    expectedSecretFor(parsed.data.targetKey) !== null
      ? derivableFlag(
          parsed.data.targetKey,
          expectedSecretFor(parsed.data.targetKey) as string,
        )
      : flagFor(parsed.data.targetKey);

  // Idempotent: upsert a valid submission row marked as
  // admin-revealed. The flagPrefix and submittedAt reflect the
  // override so the audit trail makes it clear this was not a
  // trainee solve.
  const prefix = flagPrefix(expected);
  await prisma.ctfSubmission.upsert({
    where: {
      cohortId_userId_targetKey_valid: {
        cohortId,
        userId: parsed.data.userId,
        targetKey: parsed.data.targetKey,
        valid: true,
      },
    },
    create: {
      cohortId,
      userId: parsed.data.userId,
      targetKey: parsed.data.targetKey,
      flagPrefix: prefix,
      valid: true,
    },
    update: {
      submittedAt: new Date(),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "ctf.reveal-flag",
      targetType: "user",
      targetId: parsed.data.userId,
      metadata: {
        cohortId,
        targetKey: parsed.data.targetKey,
        reason: parsed.data.reason,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    targetKey: parsed.data.targetKey,
    userId: parsed.data.userId,
  });
}
