// Reports whether the dev/btc/* lab affordances are enabled.
// Always returns 200; the value of the flag is not itself gated by
// the flag (the page that consumes this is auth-gated anyway).

import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    enabled: env().LAB_AFFORDANCES_ENABLED,
    note: "lab affordance",
  });
}
