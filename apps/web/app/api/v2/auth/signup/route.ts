import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import {
  hashPassword,
  issueAccessToken,
  issueRefreshToken,
} from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/signup",
  summary: "Create a new user account",
  responses: {
    "200": { description: "Created; access + refresh returned" },
    "400": { description: "Validation failed" },
    "409": { description: "Email already in use" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return jsonError(409, "email already in use");

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      displayName,
    },
  });

  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    kycTier: user.kycTier as 0 | 1 | 2 | 3,
  };
  const access = await issueAccessToken(claims, env().JWT_SECRET);
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
