import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/kyc/submit",
  summary: "Finalize the KYC submission for review",
  responses: {
    "200": { description: "Submitted" },
    "400": { description: "Missing profile or documents" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const profile = await prisma.kycProfile.findUnique({
    where: { userId: claims.sub },
  });
  if (
    !profile?.legalName ||
    !profile.dateOfBirth ||
    !profile.country ||
    !profile.addressLine ||
    !profile.city ||
    !profile.postalCode
  ) {
    return jsonError(400, "profile incomplete");
  }
  const docCount = await prisma.kycDocument.count({
    where: { userId: claims.sub },
  });
  if (docCount < 1) return jsonError(400, "at least one document required");

  const updated = await prisma.kycProfile.update({
    where: { userId: claims.sub },
    data: { status: "pending", submittedAt: new Date() },
  });
  return NextResponse.json({ profile: updated });
}
