import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, prisma } from "@bvbe/db";
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
  // RFC 5321 §4.5.3.1: total address max 254, local-part max 64.
  email: z
    .string()
    .email()
    .max(254)
    .refine((v) => (v.split("@")[0]?.length ?? 0) <= 64, {
      message: "email local-part exceeds 64 chars",
    }),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return jsonError(409, "email already in use");

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        displayName,
      },
    });
  } catch (err) {
    // Race window between findUnique above and create: a concurrent
    // signup with the same email (or double-clicked submit) will hit
    // the unique-index violation. Map to 409 instead of bubbling 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return jsonError(409, "email already in use");
    }
    throw err;
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
