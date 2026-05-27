import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { verifyPassword, verifyTotp } from "@bvbe/shared";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/2fa/disable",
  summary: "Disable 2FA (requires password + current code)",
  responses: { "200": { description: "OK" }, "401": { description: "Auth or code invalid" } },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.totpSecret || !user.totpEnabled) {
    return jsonError(400, "2FA not enabled");
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return jsonError(401, "invalid password");
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return jsonError(401, "invalid code");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabled: false },
  });
  return NextResponse.json({ ok: true });
}
