import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import {
  UPLOADS_DIR,
  ensureUploadsDir,
  mimeForFilename,
} from "@/lib/kyc-storage";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/kyc/documents",
  summary: "Upload a KYC document (multipart). Max 5 MB.",
  responses: {
    "200": { description: "Document accepted" },
    "400": { description: "Bad request" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = new Set(["passport", "id_card", "address_proof"]);

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data body required");
  }
  const file = form.get("file");
  const docType = String(form.get("type") ?? "");

  if (!(file instanceof File)) return jsonError(400, "file is required");
  if (!TYPES.has(docType)) return jsonError(400, "type invalid");
  if (file.size > MAX_SIZE) return jsonError(400, "file too large");

  ensureUploadsDir();

  const bytes = Buffer.from(await file.arrayBuffer());
  const id = randomBytes(8).toString("hex");
  const safeName = `${id}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storedPath = join(UPLOADS_DIR, safeName);
  writeFileSync(storedPath, bytes);

  // Some clients send application/octet-stream regardless of the
  // actual type. Fall back to filename-extension sniffing so the
  // admin review page renders a useful preview.
  const detected =
    file.type && file.type !== "application/octet-stream"
      ? file.type
      : mimeForFilename(file.name);

  const doc = await prisma.kycDocument.create({
    data: {
      userId: claims.sub,
      type: docType as "passport" | "id_card" | "address_proof",
      filename: file.name,
      storedPath: safeName,
      mimeType: detected,
      size: file.size,
      source: "upload",
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
