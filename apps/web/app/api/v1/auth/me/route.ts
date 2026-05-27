// Legacy "current user" endpoint for the mobile app v1.x line.
// Verifies the legacy JWT using the v1 module.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { verifyAccessTokenV1 } from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const header = req.headers.get("authorization");
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return jsonError(401, "unauthorized");

  let claims;
  try {
    claims = verifyAccessTokenV1(m[1] as string, env().JWT_SECRET_LEGACY);
  } catch {
    return jsonError(401, "unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
    },
  });
  if (!user) return jsonError(401, "unauthorized");

  return NextResponse.json(user);
}
