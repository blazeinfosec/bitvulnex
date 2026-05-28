// Admin / support ticket inbox listing.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }
  const tickets = await prisma.supportTicket.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  return NextResponse.json({ tickets });
}
