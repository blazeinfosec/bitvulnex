// Compliance case detail. Loads the subject's KYC profile + recent
// activity for the reviewing officer.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }
  const { id } = await ctx.params;
  const c = await prisma.complianceCase.findUnique({
    where: { id },
    include: {
      subject: {
        select: {
          id: true,
          email: true,
          displayName: true,
          kycTier: true,
          createdAt: true,
        },
      },
    },
  });
  if (!c) return jsonError(404, "not found");
  const kyc = await prisma.kycProfile.findUnique({
    where: { userId: c.subjectUserId },
  });
  return NextResponse.json({ case: c, kyc });
}
