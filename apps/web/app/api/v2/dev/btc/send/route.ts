// LAB AFFORDANCE — sends mock BTC from the pre-funded lab wallet
// to any address. Not a real exchange API. Disabled unless
// LAB_AFFORDANCES_ENABLED=true.

import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { env } from "@/lib/env";
import { callMockAffordance } from "@/lib/btc-rpc-client";

export const dynamic = "force-dynamic";

const schema = z.object({
  address: z.string().min(1),
  amountBtc: z.number().positive(),
});

export async function POST(req: Request) {
  if (!env().LAB_AFFORDANCES_ENABLED) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const { txid } = await callMockAffordance<{ txid: string }>(
    "/test/send",
    parsed.data,
  );
  return NextResponse.json({
    txid,
    note: "lab affordance — sends from pre-funded mock wallet",
  });
}
