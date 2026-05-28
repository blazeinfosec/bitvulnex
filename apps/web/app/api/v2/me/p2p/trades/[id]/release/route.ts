import { NextResponse } from "next/server";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { release } from "@/lib/p2p/trades";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/p2p/trades/{id}/release",
  summary: "Seller releases the escrowed asset to the buyer",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Trade not paid / not your trade" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const { id } = await ctx.params;
  try {
    await release({ userId: claims.sub, tradeId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "release failed");
  }
}
