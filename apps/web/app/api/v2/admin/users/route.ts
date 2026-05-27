// Admin user-management. The middleware enforces role=admin/treasury
// before reaching this handler and stamps the resolved identity into
// x-bvbe-user-id / x-bvbe-role for downstream code that needs it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { hashPassword } from "@bvbe/shared";
import { jsonError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(64).optional(),
  role: z.enum(["user", "support", "compliance", "admin", "treasury"]),
  kycTier: z.number().int().min(0).max(3).default(0),
});

export async function GET(req: Request) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
      emailVerified: true,
      totpEnabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) return jsonError(409, "email already in use");

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      kycTier: parsed.data.kycTier,
      emailVerified: true,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
    },
  });
  return NextResponse.json(user);
}
