import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";
import { UPLOADS_DIR } from "@/lib/kyc-storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string; docId: string }> },
) {
  const adminId = req.headers.get("x-bvbe-user-id");
  if (!adminId) return jsonError(401, "unauthorized");
  const { userId, docId } = await ctx.params;

  const doc = await prisma.kycDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.userId !== userId) return jsonError(404, "not found");

  let bytes: Buffer;
  try {
    bytes = readFileSync(join(UPLOADS_DIR, doc.storedPath));
  } catch {
    return jsonError(404, "file missing");
  }

  // Header values must be ByteStrings, so a filename with non-ASCII
  // characters or quotes gets an ASCII fallback plus the RFC 5987
  // encoded form.
  const asciiName =
    doc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") ||
    "document";
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": doc.mimeType,
      "content-disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    },
  });
}
