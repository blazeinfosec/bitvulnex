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
import { randomBytes } from "node:crypto";

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

const totpTickets = new Map<string, { userId: string; expiresAt: number }>();

export function consumeTotpTicket(ticket: string): string | null {
  const entry = totpTickets.get(ticket);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    totpTickets.delete(ticket);
    return null;
  }
  totpTickets.delete(ticket);
  return entry.userId;
}

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
    const ticket = randomBytes(24).toString("base64url");
    totpTickets.set(ticket, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
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
