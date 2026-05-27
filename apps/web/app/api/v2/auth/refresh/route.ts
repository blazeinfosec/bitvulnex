import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
} from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/refresh",
  summary: "Exchange a refresh token for a new access + refresh pair",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Invalid or expired refresh token" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({ refresh: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { refresh } = parsed.data;

  const tokenHash = hashRefreshToken(refresh);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!stored || stored.expiresAt < new Date()) {
    return jsonError(401, "invalid refresh token");
  }

  const user = stored.user;
  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    kycTier: user.kycTier as 0 | 1 | 2 | 3,
  };
  const access = await issueAccessToken(claims, env().JWT_SECRET);
  const next = issueRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: next.tokenHash,
      expiresAt: next.expiresAt,
    },
  });
  return NextResponse.json({ access, refresh: next.token });
}
