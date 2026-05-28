import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { requireTier, TierError } from "@/lib/kyc-tier";
import { openPosition } from "@/lib/engine/margin-orchestrator";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/margin/positions",
  summary: "Open a leveraged margin position",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Bad request" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient for leverage" },
  },
});
registerEndpoint({
  method: "get",
  path: "/api/v2/me/margin/positions",
  summary: "List the caller's open and closed margin positions",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((s) => Number(s) > 0);

const openSchema = z.object({
  pair: z.string().regex(/^[A-Z]+\/[A-Z]+$/),
  side: z.enum(["long", "short"]),
  size: positiveDecimal,
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5), z.literal(10)]),
});

// Per-tier leverage caps. String tier labels mirror the
// feature-flag config surface used elsewhere in the trading
// engine, so requireTier receives the same shape regardless of
// caller.
function tierFor(leverage: number): string {
  if (leverage <= 2) return "1";
  if (leverage <= 5) return "2";
  return "10";
}

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, openSchema);
  if (parsed.error) return parsed.error;

  try {
    requireTier(claims, tierFor(parsed.data.leverage));
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }

  try {
    const result = await openPosition({
      userId: claims.sub,
      pair: parsed.data.pair,
      side: parsed.data.side,
      size: parsed.data.size,
      leverage: parsed.data.leverage,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "open failed");
  }
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const positions = await prisma.marginPosition.findMany({
    where: { userId: claims.sub },
    orderBy: { openedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    positions: positions.map((p) => ({
      ...p,
      size: p.size.toString(),
      entryPrice: p.entryPrice.toString(),
      collateral: p.collateral.toString(),
      liquidationPrice: p.liquidationPrice.toString(),
      closedPrice: p.closedPrice?.toString() ?? null,
      realizedPnl: p.realizedPnl?.toString() ?? null,
    })),
  });
}
