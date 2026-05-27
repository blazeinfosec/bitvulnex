import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { generateTotpSecret, totpUri } from "@bvbe/shared";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/2fa/enable",
  summary: "Generate a TOTP secret + provisioning URI",
  responses: { "200": { description: "OK" }, "401": { description: "Auth required" } },
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: claims.sub },
    data: { totpSecret: secret, totpEnabled: false },
  });
  return NextResponse.json({
    secret,
    uri: totpUri(secret, claims.email),
  });
}
