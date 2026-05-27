import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { hashPassword } from "@bvbe/shared";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/password-reset/confirm",
  summary: "Confirm a password reset using the emailed token",
  responses: {
    "200": { description: "Password updated" },
    "400": { description: "Bad or expired token" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { token, newPassword } = parsed.data;

  const reset = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!reset || reset.expiresAt < new Date()) {
    return jsonError(400, "invalid or expired token");
  }

  await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await prisma.passwordResetToken.delete({ where: { id: reset.id } });

  return NextResponse.json({ ok: true });
}
