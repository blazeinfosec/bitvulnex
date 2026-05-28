// GET /api/v2/me/flags — UI feature flags resolved for the caller.

import { NextResponse } from "next/server";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { resolveFlags } from "@/lib/feature-flags";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/flags",
  summary: "UI feature flags for the caller",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const flags = resolveFlags(claims);
  return NextResponse.json({ flags });
}
