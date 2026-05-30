import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { ctfModeEnabled } from "@/lib/ctf";
import { saltFingerprint } from "@/lib/ctf/cohort";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/ctf/cohorts",
  summary: "List CTF cohorts",
  responses: { "200": { description: "Cohorts" } },
});
registerEndpoint({
  method: "post",
  path: "/api/v2/admin/ctf/cohorts",
  summary: "Create a new CTF cohort",
  responses: { "201": { description: "Created" } },
});

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  hintsDefault: z.boolean().default(false),
  verboseUnlockSeconds: z.number().int().min(0).max(3600).default(900),
});

export async function GET(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || (claims.role !== "admin" && claims.role !== "support"))
    return jsonError(403, "forbidden");

  const cohorts = await prisma.cohort.findMany({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      name: true,
      saltFingerprint: true,
      hintsDefault: true,
      verboseUnlockSeconds: true,
      startedAt: true,
      archivedAt: true,
      _count: { select: { members: true, submissions: true, hintReveals: true } },
    },
  });
  return NextResponse.json({ cohorts });
}

export async function POST(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || claims.role !== "admin") return jsonError(403, "forbidden");

  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;

  const salt = process.env.CTF_SALT ?? "";
  const cohort = await prisma.cohort.create({
    data: {
      name: parsed.data.name,
      saltFingerprint: saltFingerprint(salt),
      hintsDefault: parsed.data.hintsDefault,
      verboseUnlockSeconds: parsed.data.verboseUnlockSeconds,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "ctf.cohort.create",
      targetType: "cohort",
      targetId: cohort.id,
      metadata: { name: cohort.name, hintsDefault: cohort.hintsDefault },
    },
  });

  return NextResponse.json(cohort, { status: 201 });
}
