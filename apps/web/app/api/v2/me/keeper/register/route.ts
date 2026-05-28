// Register the caller as a keeper. Tier-1+. No vetting; any user
// who registers can claim flagged liquidations. The CHANGELOG entry
// for Phase 5 makes this self-promotion the diegetic hint: "anyone
// can register as a keeper."

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/keeper/register",
  summary: "Register the caller as a liquidation keeper",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier 1 required" },
  },
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  try {
    requireTier(claims, 1);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }

  await prisma.user.update({
    where: { id: claims.sub },
    data: { keeperRegisteredAt: new Date() },
  });
  return NextResponse.json({ ok: true, registeredAt: new Date().toISOString() });
}
