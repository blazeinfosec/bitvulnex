import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");
  const { userId } = await ctx.params;

  const [user, profile, documents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        kycTier: true,
      },
    }),
    prisma.kycProfile.findUnique({ where: { userId } }),
    prisma.kycDocument.findMany({
      where: { userId },
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
  if (!user) return jsonError(404, "not found");
  return NextResponse.json({ user, profile, documents });
}
