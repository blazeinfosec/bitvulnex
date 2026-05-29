import { NextResponse } from "next/server";
import { z } from "zod";
import { ctfModeEnabled } from "@/lib/ctf";
import { processClaim } from "@/lib/ctf/claim";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/ctf/claim",
  summary:
    "Submit exploit proof (Pattern B) or discovered secret (Pattern C) and receive the CTF flag",
  responses: {
    "200": { description: "Flag" },
    "400": { description: "Invalid proof / unknown vuln" },
    "404": { description: "CTF mode disabled" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  vulnId: z.string().min(1).max(20),
  proof: z.string().min(1).max(2048),
});

export async function POST(req: Request) {
  // 404 (not 403) when CTF mode is off — the endpoint should not
  // appear to exist at all to the casual prober.
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const result = await processClaim(parsed.data.vulnId, parsed.data.proof);
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ flag: result.flag });
}
