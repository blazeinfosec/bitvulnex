// List and create compliance cases. The list view feeds the
// /admin/compliance queue; create is invoked from the user-detail
// page when an admin opens a case.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  subjectUserId: z.string(),
  notes: z.string().optional(),
});

async function gate(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return { error: jsonError(401, "unauthorized") };
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return { error: jsonError(e.status, e.message) };
    throw e;
  }
  return { claims };
}

export async function GET(req: Request) {
  const g = await gate(req);
  if (g.error) return g.error;
  const cases = await prisma.complianceCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      subject: { select: { id: true, email: true, displayName: true } },
    },
  });
  return NextResponse.json({ cases });
}

export async function POST(req: Request) {
  const g = await gate(req);
  if (g.error) return g.error;
  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;
  const subject = await prisma.user.findUnique({
    where: { id: parsed.data.subjectUserId },
  });
  if (!subject) return jsonError(404, "subject not found");
  const created = await prisma.complianceCase.create({
    data: {
      subjectUserId: parsed.data.subjectUserId,
      openedById: g.claims.sub,
      notes: parsed.data.notes ?? null,
      status: "open",
    },
  });
  return NextResponse.json({ case: created });
}
