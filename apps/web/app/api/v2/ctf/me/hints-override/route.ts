import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { ctfModeEnabled } from "@/lib/ctf";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "patch",
  path: "/api/v2/ctf/me/hints-override",
  summary:
    "Trainee opt-out / opt-in from the cohort's default hint visibility",
  responses: {
    "200": { description: "Updated" },
    "400": { description: "Bad body" },
    "401": { description: "Auth required" },
    "404": { description: "CTF mode disabled" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  override: z.enum(["follow", "enable", "disable"]),
});

export async function PATCH(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  await prisma.user.update({
    where: { id: claims.sub },
    data: { hintsOverride: parsed.data.override },
  });

  // Audit-log the override change so an instructor can spot cohort
  // members who toggled hints on/off mid-CTF.
  await prisma.adminAuditLog.create({
    data: {
      actorUserId: claims.sub,
      action: "ctf.hints-override",
      targetType: "user",
      targetId: claims.sub,
      metadata: { override: parsed.data.override },
    },
  });

  return NextResponse.json({ override: parsed.data.override });
}
