import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/kyc",
  summary: "Return the caller's KYC profile and documents",
  responses: {
    "200": { description: "KYC state" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const [profile, docs] = await Promise.all([
    prisma.kycProfile.findUnique({ where: { userId: claims.sub } }),
    prisma.kycDocument.findMany({
      where: { userId: claims.sub },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        filename: true,
        mimeType: true,
        size: true,
        source: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({ profile, documents: docs });
}
