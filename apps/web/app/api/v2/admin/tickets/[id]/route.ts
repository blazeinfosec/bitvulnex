// Admin ticket thread. Renders the message bodies via the admin
// sanitizer so the agent can see the user's formatting (bold, code
// blocks, links) in context.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { sanitizeForAdmin } from "@bvbe/shared";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }
  const { id } = await ctx.params;
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (!ticket) return jsonError(404, "not found");
  const messages = await prisma.supportTicketMessage.findMany({
    where: { ticketId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    ticket,
    messages: messages.map((m) => ({
      ...m,
      bodyHtml: sanitizeForAdmin(m.bodyMd),
    })),
  });
}
