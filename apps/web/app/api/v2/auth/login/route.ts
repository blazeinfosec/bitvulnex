import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import {
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
} from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { mintTotpTicket } from "@/lib/totp-tickets";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/login",
  summary: "Log in with email + password (returns 2FA ticket if enabled)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Invalid credentials" },
  },
});

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
  if (!user) return jsonError(401, "invalid credentials");
  if (!(await verifyPassword(password, user.passwordHash))) {
    return jsonError(401, "invalid credentials");
  }

  if (user.totpEnabled) {
    const ticket = await mintTotpTicket(user.id);
    return NextResponse.json({ totpRequired: true, ticket });
  }

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
