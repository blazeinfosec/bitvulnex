import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { TierError, requireTreasury } from "@/lib/kyc-tier";
import {
  DraftValidationError,
  NotFoundError,
  broadcastDraft,
} from "@/lib/treasury/coordinator";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/treasury/drafts/{id}/broadcast",
  summary: "Broadcast a signed treasury PSBT draft",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Draft not broadcastable" },
    "401": { description: "Auth required" },
    "403": { description: "Treasury role required" },
    "404": { description: "Draft not found" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  overridePsbt: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTreasury(claims);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const { id } = await ctx.params;
  try {
    const draft = await broadcastDraft({
      draftId: id,
      broadcasterUserId: claims.sub,
      overridePsbt: parsed.data.overridePsbt,
    });
    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof NotFoundError) return jsonError(e.status, e.message);
    if (e instanceof DraftValidationError)
      return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "broadcast failed");
  }
}
