// Internal user-detail endpoint. Returns the full record including
// auth material — internal tooling occasionally needs the password
// hash version and TOTP shape for audit/forensic purposes.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return jsonError(404, "not found");
  return NextResponse.json({ user });
}
