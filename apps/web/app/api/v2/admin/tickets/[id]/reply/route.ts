// Agent reply on a support ticket.

import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { replyToTicket } from "@/lib/support/tickets";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/tickets/{id}/reply",
  summary: "Post an agent reply on a support ticket",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({ body: z.string().min(1).max(10_000) });

export async function POST(
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
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { id } = await ctx.params;
  const msg = await replyToTicket({
    ticketId: id,
    authorId: claims.sub,
    isAgent: true,
    body: parsed.data.body,
  });
  return NextResponse.json({ message: msg });
}
