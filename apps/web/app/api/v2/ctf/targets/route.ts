import { NextResponse } from "next/server";
import { ctfModeEnabled } from "@/lib/ctf";
import { ALL_TARGETS, targetCounts } from "@/lib/ctf/catalog";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/ctf/targets",
  summary: "Catalog of every CTF target (40 plants + 4 chains)",
  responses: {
    "200": { description: "Catalog" },
    "404": { description: "CTF mode disabled" },
  },
});

export const dynamic = "force-dynamic";

export async function GET() {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const counts = targetCounts();
  return NextResponse.json({
    counts,
    targets: ALL_TARGETS,
  });
}
