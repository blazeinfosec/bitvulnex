import { NextResponse } from "next/server";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { cancelOffer } from "@/lib/p2p/offers";

registerEndpoint({
  method: "delete",
  path: "/api/v2/me/p2p/offers/{id}",
  summary: "Cancel a P2P offer the caller owns",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Offer not found" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  try {
    await cancelOffer({ userId: claims.sub, offerId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "cancel failed");
  }
}
