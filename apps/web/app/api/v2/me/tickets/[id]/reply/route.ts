// User reply on their own ticket.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { replyToTicket } from "@/lib/support/tickets";

export const dynamic = "force-dynamic";

const schema = z.object({ body: z.string().min(1).max(10_000) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { id } = await ctx.params;
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) return jsonError(404, "not found");
  if (ticket.userId !== claims.sub) return jsonError(403, "forbidden");
  const msg = await replyToTicket({
    ticketId: id,
    authorId: claims.sub,
    isAgent: false,
    body: parsed.data.body,
  });
  return NextResponse.json({ message: msg });
}
