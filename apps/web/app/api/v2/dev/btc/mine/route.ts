import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { env } from "@/lib/env";
import { callMockAffordance, MockAffordanceError } from "@/lib/btc-rpc-client";

export const dynamic = "force-dynamic";

const schema = z.object({ blocks: z.number().int().min(1).max(100) });

export async function POST(req: Request) {
  if (!env().LAB_AFFORDANCES_ENABLED) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  let result: { blocks: number; height: number };
  try {
    result = await callMockAffordance<{ blocks: number; height: number }>(
      "/test/mine",
      parsed.data,
    );
  } catch (e) {
    if (e instanceof MockAffordanceError) return jsonError(e.status, e.message);
    throw e;
  }
  return NextResponse.json({ ...result, note: "lab affordance — mines mock blocks" });
}
