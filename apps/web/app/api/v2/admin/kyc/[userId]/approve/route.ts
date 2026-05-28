import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { jsonError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({ tier: z.number().int().min(1).max(3) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");
  const { userId } = await ctx.params;
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return jsonError(404, "user not found");
  const profile = await prisma.kycProfile.findUnique({ where: { userId } });
  if (!profile) return jsonError(404, "kyc submission not found");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { kycTier: parsed.data.tier },
    }),
    prisma.kycProfile.update({
      where: { userId },
      data: {
        status: "approved",
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
