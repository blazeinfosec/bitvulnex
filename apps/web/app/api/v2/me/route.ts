import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me",
  summary: "Return the authenticated user's profile",
  responses: {
    "200": { description: "Profile" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
      emailVerified: true,
      totpEnabled: true,
      createdAt: true,
    },
  });
  if (!user) return jsonError(401, "unauthorized");

  return NextResponse.json(user);
}
