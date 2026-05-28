// Internal LB healthcheck. Pings the web tier from the internal-only
// nginx; the public edge never proxies this path.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
