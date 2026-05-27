import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { verifyTotp } from "@bvbe/shared";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/2fa/verify",
  summary: "Verify first TOTP code and enable 2FA",
  responses: { "200": { description: "OK" }, "401": { description: "Auth or code invalid" } },
});

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.totpSecret) return jsonError(400, "no pending 2FA enrolment");
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return jsonError(401, "invalid code");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true },
  });
  return NextResponse.json({ ok: true });
}
