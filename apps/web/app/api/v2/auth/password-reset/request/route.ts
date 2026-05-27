import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@bvbe/db";
import { readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/auth/password-reset/request",
  summary: "Request a password reset (always returns 200 to avoid enumeration)",
  responses: {
    "200": { description: "OK (regardless of email existence)" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

function generateResetToken(userId: string): string {
  return createHash("sha256")
    .update(userId + Date.now())
    .digest("hex")
    .slice(0, 16);
}

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = generateResetToken(user.id);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    // No real email service in lab — log the reset link to server console.
    // eslint-disable-next-line no-console
    console.log(
      `[password-reset] http://exchange.local/reset?token=${token} for ${email}`,
    );
  }

  return NextResponse.json({ ok: true });
}
