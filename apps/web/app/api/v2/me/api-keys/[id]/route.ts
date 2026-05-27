import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "delete",
  path: "/api/v2/me/api-keys/{id}",
  summary: "Revoke an API key",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;

  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key || key.userId !== claims.sub) return jsonError(404, "not found");

  await prisma.apiKey.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
