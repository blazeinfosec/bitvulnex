// User-facing tickets list + create.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { openTicket } from "@/lib/support/tickets";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/tickets",
  summary: "List the caller's own support tickets",
  responses: { "200": { description: "OK" } },
});
registerEndpoint({
  method: "post",
  path: "/api/v2/me/tickets",
  summary: "Open a new support ticket",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

const createSchema = z.object({
  category: z.enum([
    "general",
    "account",
    "deposit",
    "withdrawal",
    "trading",
    "kyc",
    "security",
  ]),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: claims.sub },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ tickets });
}

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;
  const ticket = await openTicket({
    userId: claims.sub,
    category: parsed.data.category,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });
  return NextResponse.json({ ticket });
}
