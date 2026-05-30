import { NextResponse } from "next/server";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { ctfModeEnabled } from "@/lib/ctf";
import { clearHintCache, loadAllHints } from "@/lib/ctf/hints";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/ctf/reload-hints",
  summary: "Clear the in-memory hint cache so docs/hints edits take effect",
  responses: { "200": { description: "Reloaded" } },
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || claims.role !== "admin") return jsonError(403, "forbidden");

  clearHintCache();
  const all = loadAllHints();
  return NextResponse.json({ loaded: all.size });
}
