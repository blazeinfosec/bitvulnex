// Beta: OFAC sanctions list import. Compliance officers paste in the
// vendor's XML export; the handler returns the normalized entries so
// the operator can review them before pushing to the sanctions table.

import { NextResponse } from "next/server";
import { z } from "zod";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";
import { importSanctionsXml } from "@/lib/compliance/sanctions-import";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/compliance/sanctions-import",
  summary: "Import an OFAC sanctions list (beta)",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Parse failed" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({ xml: z.string().min(1).max(1_000_000) });

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  try {
    const result = await importSanctionsXml(parsed.data.xml);
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "parse failed");
  }
}
