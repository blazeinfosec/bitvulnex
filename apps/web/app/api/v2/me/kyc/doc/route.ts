import { readFileSync } from "node:fs";
import { join } from "node:path";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { UPLOADS_DIR, mimeForFilename } from "@/lib/kyc-storage";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/kyc/doc",
  summary: "Download a KYC document by stored filename",
  responses: {
    "200": { description: "Binary body" },
    "401": { description: "Auth required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  if (!file) return jsonError(400, "file param required");

  // Serve the file from the uploads directory.
  const path = join(UPLOADS_DIR, file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return jsonError(404, "not found");
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": mimeForFilename(file),
      "content-disposition": `inline; filename="${file}"`,
    },
  });
}
