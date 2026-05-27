import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { hashRefreshToken } from "@bvbe/shared";
import { readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/logout",
  summary: "Revoke a refresh token (logs the device out)",
  responses: { "200": { description: "OK (idempotent)" } },
});

export const dynamic = "force-dynamic";

const schema = z.object({ refresh: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const tokenHash = hashRefreshToken(parsed.data.refresh);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
  return NextResponse.json({ ok: true });
}
