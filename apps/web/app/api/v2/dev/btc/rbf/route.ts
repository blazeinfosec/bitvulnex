// LAB AFFORDANCE — RBF-replace a recent mempool TX with one that
// sends to a different address. Used to demonstrate V-42 zero-conf
// double-spend.

import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { env } from "@/lib/env";
import { callMockAffordance } from "@/lib/btc-rpc-client";

export const dynamic = "force-dynamic";

const schema = z.object({
  txid: z.string().regex(/^[0-9a-f]{64}$/),
  newAddress: z.string().min(1),
});

export async function POST(req: Request) {
  if (!env().LAB_AFFORDANCES_ENABLED) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const result = await callMockAffordance<{ replacementTxid: string }>(
    "/test/rbf",
    parsed.data,
  );
  return NextResponse.json({
    ...result,
    note: "lab affordance — RBF-replaces a mempool tx",
  });
}
