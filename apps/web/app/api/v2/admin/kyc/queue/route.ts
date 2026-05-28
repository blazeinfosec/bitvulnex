import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");

  const queue = await prisma.kycProfile.findMany({
    where: { status: "pending" },
    orderBy: { submittedAt: "asc" },
    include: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  return NextResponse.json({ queue });
}
