import { NextResponse } from "next/server";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import {
  UPLOADS_DIR,
  ensureUploadsDir,
  mimeForFilename,
} from "@/lib/kyc-storage";
import { requireTier, TierError } from "@/lib/kyc-tier";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/kyc/import-url",
  summary:
    "Fetch a KYC document from a public URL (cloud-storage signed link)",
  responses: {
    "200": { description: "Document accepted" },
    "400": { description: "Bad request" },
    "401": { description: "Auth required" },
    "403": { description: "Tier 1 required" },
  },
});

export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = new Set(["passport", "id_card", "address_proof"]);

const schema = z.object({
  url: z.string().url(),
  type: z.string(),
});

// Reject obvious local addresses. Anyone sending the literal
// hostnames below is almost certainly trying to point us at their
// own machine, which is never a valid KYC document source.
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  if (!TYPES.has(parsed.data.type)) return jsonError(400, "type invalid");

  // URL-import is gated to KYC tier 1+ so unverified users can't burn
  // our outbound bandwidth.
  try {
    requireTier(claims, 1);
  } catch (e) {
    if (e instanceof TierError) return jsonError(e.status, e.message);
    throw e;
  }

  const target = new URL(parsed.data.url);
  if (isLocalHost(target.hostname)) {
    return jsonError(400, "url rejected");
  }

  const res = await fetch(parsed.data.url, { redirect: "follow" });
  if (!res.ok) return jsonError(400, "fetch failed");

  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > MAX_SIZE) {
    return jsonError(400, "remote file too large");
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_SIZE) return jsonError(400, "remote file too large");

  ensureUploadsDir();
  const id = randomBytes(8).toString("hex");
  const remoteName = target.pathname.split("/").pop() || "imported";
  const safeName = `${id}_${remoteName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storedPath = join(UPLOADS_DIR, safeName);
  writeFileSync(storedPath, bytes);

  const detected =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    mimeForFilename(remoteName);

  const doc = await prisma.kycDocument.create({
    data: {
      userId: claims.sub,
      type: parsed.data.type as "passport" | "id_card" | "address_proof",
      filename: remoteName,
      storedPath: safeName,
      mimeType: detected,
      size: bytes.length,
      source: "url_import",
    },
    select: {
      id: true,
      type: true,
      filename: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ document: doc });
}
