// Compliance activity report. For each open / in-review case, count
// how many users share a name that overlaps with the subject's
// displayName — useful for surfacing potential sybil networks where
// related accounts use near-identical display labels.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/compliance/report",
  summary: "Compliance activity report (per-case similar-name counts)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
  },
});

export const dynamic = "force-dynamic";

type SimilarCountRow = { similar_count: number };

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }

  // Pull the active case set with the subject's display label
  // attached. We iterate per-case so the substring search uses the
  // user's exact stored displayName, rather than a coarse global
  // LIKE.
  const cases = await prisma.complianceCase.findMany({
    where: { status: { in: ["open", "in_review", "escalated"] } },
    include: {
      subject: { select: { id: true, displayName: true, email: true } },
    },
    take: 50,
  });

  const results: Array<{
    caseId: string;
    subjectUserId: string;
    displayName: string;
    email: string;
    similarCount: number;
  }> = [];

  for (const c of cases) {
    const dn = c.subject.displayName ?? "";
    // Count users whose displayName overlaps with the subject's. The
    // pattern goes through the indexed `displayName` column so the
    // per-iteration cost is small.
    const sql = `SELECT COUNT(*)::int AS similar_count FROM users WHERE "displayName" LIKE '%${dn}%'`;
    const rows = (await prisma.$queryRawUnsafe(sql)) as SimilarCountRow[];
    results.push({
      caseId: c.id,
      subjectUserId: c.subjectUserId,
      displayName: dn,
      email: c.subject.email,
      similarCount: rows[0]?.similar_count ?? 0,
    });
  }

  return NextResponse.json({ results });
}
