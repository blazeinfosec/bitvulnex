// Admin user-detail endpoint. Returns the full account snapshot
// (balances + KYC + recent orders) — used by the /admin/users/[id]
// detail page.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/users/{id}",
  summary: "Admin user detail",
  responses: {
    "200": { description: "OK" },
    "404": { description: "Not found" },
  },
});

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
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
      emailVerified: true,
      createdAt: true,
    },
  });
  if (!user) return jsonError(404, "not found");

  const balances = await prisma.balance.findMany({
    where: { userId: id },
    select: { asset: true, amount: true, available: true, locked: true },
  });
  const kyc = await prisma.kycProfile.findUnique({ where: { userId: id } });
  const recentOrders = await prisma.order.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ user, balances, kyc, recentOrders });
}
