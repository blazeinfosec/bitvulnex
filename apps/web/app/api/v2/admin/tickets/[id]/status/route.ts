// Change a ticket's status (agent-only).

import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { changeStatus } from "@/lib/support/tickets";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum([
    "open",
    "awaiting_user",
    "awaiting_agent",
    "resolved",
    "closed",
  ]),
});

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
  const ticket = await changeStatus({
    ticketId: id,
    status: parsed.data.status,
    actorId: claims.sub,
  });
  return NextResponse.json({ ticket });
}
