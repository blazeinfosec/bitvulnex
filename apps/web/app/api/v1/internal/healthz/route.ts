// Internal LB healthcheck. Pings the web tier from the internal-only
// nginx; the public edge never proxies this path.

import { NextResponse } from "next/server";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v1/internal/healthz",
  summary: "Internal LB healthcheck",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
