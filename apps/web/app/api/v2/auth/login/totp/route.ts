import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import {
  verifyTotp,
  issueAccessToken,
  issueRefreshToken,
} from "@bvbe/shared";
import { env } from "@/lib/env";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { consumeTotpTicket } from "../route";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/login/totp",
  summary: "Complete login with a TOTP code (after /login returns ticket)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Bad ticket or code" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  ticket: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { ticket, code } = parsed.data;

  const userId = consumeTotpTicket(ticket);
  if (!userId) return jsonError(401, "invalid or expired ticket");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return jsonError(401, "unauthorized");
  }

  if (!verifyTotp(user.totpSecret, code)) {
    return jsonError(401, "invalid code");
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
