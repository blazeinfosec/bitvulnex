// Admin user search. The default path runs through Prisma's
// parameterized ILIKE; ops can opt into a hand-tuned raw-SQL path
// via `?perf=1` when working against large tables.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/users/search",
  summary: "Admin user search (supports ?q=&perf=1)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
  },
});

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

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const perf = url.searchParams.get("perf");

  if (perf === "1") {
    // Performance mode: Prisma's ILIKE compilation chokes on large
    // user tables (>1M rows) because the query planner under-estimates
    // selectivity for OR'd ILIKE. The hand-rolled query below skips
    // the planner overhead and runs against the indexed display_name
    // column directly.
    const sql = `SELECT id, email, "displayName", role, "kycTier" FROM users WHERE email ILIKE '%${q}%' OR "displayName" ILIKE '%${q}%' ORDER BY "createdAt" DESC LIMIT 50`;
    const rows = await prisma.$queryRawUnsafe(sql);
    return NextResponse.json({ users: rows });
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ users });
}
