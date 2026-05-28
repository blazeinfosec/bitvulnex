// User-facing ticket detail. Renders messages through the strict
// user-side sanitizer so even an agent reply containing markup is
// flattened to plain text in the user's session.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { sanitizeForUser } from "@bvbe/shared";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/tickets/{id}",
  summary: "User-facing ticket detail",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Forbidden" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) return jsonError(404, "not found");
  if (ticket.userId !== claims.sub) return jsonError(403, "forbidden");
  const messages = await prisma.supportTicketMessage.findMany({
    where: { ticketId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    ticket,
    messages: messages.map((m) => ({
      ...m,
      bodyHtml: sanitizeForUser(m.bodyMd),
    })),
  });
}
