import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { TierError, requireTreasury } from "@/lib/kyc-tier";
import {
  DraftValidationError,
  createDraft,
} from "@/lib/treasury/coordinator";

registerEndpoint({
  method: "post",
  path: "/api/v2/admin/treasury/drafts",
  summary: "Create a treasury PSBT draft (cold → hot)",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation" },
    "401": { description: "Auth required" },
    "403": { description: "Treasury role required" },
  },
});

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/treasury/drafts",
  summary: "List treasury drafts",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
    "403": { description: "Treasury role required" },
  },
});

export const dynamic = "force-dynamic";

const createSchema = z.object({
  intendedOutputs: z
    .array(
      z.object({
        address: z.string().min(1),
        amountSat: z.number().int().positive(),
      }),
    )
    .min(1),
  intentNote: z.string().max(280).optional(),
});

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTreasury(claims);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;

  try {
    const draft = await createDraft({
      authorUserId: claims.sub,
      intendedOutputs: parsed.data.intendedOutputs,
      intentNote: parsed.data.intentNote,
    });
    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof DraftValidationError)
      return jsonError(e.status, e.message);
    return jsonError(400, e instanceof Error ? e.message : "create failed");
  }
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireTreasury(claims);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }
  const drafts = await prisma.treasuryDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { signatures: true },
  });
  return NextResponse.json({ drafts });
}
