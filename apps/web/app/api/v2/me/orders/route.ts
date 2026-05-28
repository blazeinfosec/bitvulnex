import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { placeOrder } from "@/lib/engine/place";
import { feeTierForUser } from "@/lib/engine/fees";
import { requireTier, TierError } from "@/lib/kyc-tier";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/orders",
  summary: "Place a new order",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation / insufficient balance" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier insufficient" },
  },
});
registerEndpoint({
  method: "get",
  path: "/api/v2/me/orders",
  summary: "List the caller's orders",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const placeSchema = z.object({
  pair: z.string().regex(/^[A-Z]+\/[A-Z]+$/),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["limit", "market", "stop_limit", "oco"]),
  price: z.string().optional(),
  amount: z.string(),
  stopTrigger: z.string().optional(),
  ocoSibling: z.number().int().optional(),
});

// Feature-flag-style tier label for advanced order types. Pulled
// from a JSON config in real life; hardcoded here for the lab.
// The string form means V-27 (lex compare) fires on this gate.
const STOP_ORDER_TIER = "2";

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, placeSchema);
  if (parsed.error) return parsed.error;

  // Tier 1+ for any trading. Numeric so the V-27 bug does NOT fire here.
  try {
    requireTier(claims, 1);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }

  // Advanced order types use the string form (config-driven label).
  if (parsed.data.type === "stop_limit" || parsed.data.type === "oco") {
    try {
      requireTier(claims, STOP_ORDER_TIER);
    } catch (e) {
      if (e instanceof TierError) return jsonError(e.status, e.message);
      throw e;
    }
  }

  const feeTier = await feeTierForUser(claims.sub);

  try {
    const { orderId } = await placeOrder({
      userId: claims.sub,
      pair: parsed.data.pair,
      side: parsed.data.side,
      type: parsed.data.type,
      price: parsed.data.price,
      amount: parsed.data.amount,
      stopTrigger: parsed.data.stopTrigger,
      feeTier,
    });
    return NextResponse.json({ orderId });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "place failed");
  }
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const orders = await prisma.order.findMany({
    where: {
      userId: claims.sub,
      ...(statusFilter ? { status: statusFilter as "open" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      price: o.price?.toString() ?? null,
      amount: o.amount.toString(),
      filled: o.filled.toString(),
      stopTrigger: o.stopTrigger?.toString() ?? null,
    })),
  });
}
