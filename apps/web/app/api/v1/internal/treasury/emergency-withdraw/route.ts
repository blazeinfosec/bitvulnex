// Emergency-withdraw is the operator escape hatch for the treasury
// pipeline: when the standard `POST /api/v2/admin/treasury/drafts/[id]/broadcast`
// path is unreachable (e.g. the admin panel is down during an
// incident), the internal control plane can broadcast a signed draft
// directly. The caller is expected to be the on-call treasury
// engineer running from the bastion.

import { NextResponse } from "next/server";
import { z } from "zod";
import { broadcastDraft } from "@/lib/treasury/coordinator";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v1/internal/treasury/emergency-withdraw",
  summary: "Operator emergency-withdraw bypass for signed treasury drafts",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation" },
    "404": { description: "Draft not found" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  draftId: z.string(),
  overridePsbt: z.string(),
  broadcasterUserId: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  try {
    const result = await broadcastDraft({
      draftId: parsed.data.draftId,
      broadcasterUserId: parsed.data.broadcasterUserId ?? "internal-ops",
      overridePsbt: parsed.data.overridePsbt,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "broadcast failed");
  }
}
