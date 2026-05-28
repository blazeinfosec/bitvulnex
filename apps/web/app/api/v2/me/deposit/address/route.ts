import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { rpc } from "@/lib/btc-rpc-client";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/deposit/address",
  summary: "Get or derive a BTC deposit address for the caller",
  responses: {
    "200": { description: "address" },
    "401": { description: "Auth required" },
    "403": { description: "KYC tier 1 required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  if (claims.kycTier < 1) {
    return jsonError(403, "complete KYC tier 1 to deposit");
  }

  const existing = await prisma.bitcoinAddress.findFirst({
    where: { userId: claims.sub, asset: "BTC" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return NextResponse.json({ asset: "BTC", address: existing.address });
  }

  const newAddress = await rpc<string>("getnewaddress");
  const created = await prisma.bitcoinAddress.create({
    data: {
      userId: claims.sub,
      asset: "BTC",
      address: newAddress,
      derivationIndex: 0,
    },
  });
  return NextResponse.json({ asset: "BTC", address: created.address });
}
