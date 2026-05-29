import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { acceptOtc } from "@/lib/otc/accept";
import { maybeEmitFlag } from "@/lib/ctf/emit";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/otc/accept",
  summary: "Accept an OTC quote and execute against desk inventory",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / ticket state / balance" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
  },
});

export const dynamic = "force-dynamic";

// Standard taker fee for desk fills. Institutional makers connecting
// through the internal OTC console identify themselves with the
// x-bvbe-desk-role header so the matcher can apply maker pricing.
const TAKER_FEE_BPS = 25;
const MAKER_FEE_BPS = 0;

const schema = z.object({ ticketId: z.string().min(1) });

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTier(claims, 2);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const deskRole = req.headers.get("x-bvbe-desk-role");
  const feeBps = deskRole === "maker" ? MAKER_FEE_BPS : TAKER_FEE_BPS;

  try {
    const out = await acceptOtc({
      userId: claims.sub,
      ticketId: parsed.data.ticketId,
      feeBps,
    });
    const body = deskRole === "maker" ? maybeEmitFlag(out, "V-46") : out;
    return NextResponse.json(body);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "accept failed");
  }
}
