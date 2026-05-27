// Legacy login endpoint for the mobile app v1.x line. Returns a
// HS256-signed JWT minted by jwt-v1. The v2 endpoint at
// /api/v2/auth/login is what new clients should use.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import {
  issueAccessTokenV1,
  issueRefreshToken,
  verifyPassword,
} from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return jsonError(401, "invalid credentials");
  }
  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    kycTier: user.kycTier as 0 | 1 | 2 | 3,
  };
  const access = issueAccessTokenV1(claims, env().JWT_SECRET_LEGACY);
  const refresh = issueRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    },
  });
  return NextResponse.json({ access, refresh: refresh.token });
}
