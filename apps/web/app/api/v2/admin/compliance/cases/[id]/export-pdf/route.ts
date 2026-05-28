// Export the compliance case as a PDF bundle. The renderer shells out
// to the pdftk-mock binary that lives at /usr/local/bin/pdftk-mock in
// the docker image; locally the script in scripts/pdftk-mock.sh is on
// PATH. `name` is an operator-supplied label that ends up in the
// output filename.

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { requireAdmin, RoleError } from "@/lib/auth-role";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/compliance/cases/{id}/export-pdf",
  summary: "Export compliance case as a PDF bundle",
  responses: {
    "200": { description: "PDF" },
    "401": { description: "Auth required" },
    "403": { description: "Admin required" },
    "404": { description: "Not found" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  try {
    requireAdmin(claims);
  } catch (e) {
    if (e instanceof RoleError) return jsonError(e.status, e.message);
    throw e;
  }
  const { id } = await ctx.params;
  const c = await prisma.complianceCase.findUnique({ where: { id } });
  if (!c) return jsonError(404, "not found");

  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? `case-${id}`;

  // We shell out so we can redirect pdftk-mock's chatty stderr to
  // /dev/null — Node's spawn() without `shell: true` doesn't accept
  // shell redirection metacharacters.
  const cmd = `pdftk-mock --case ${id} --out /tmp/${name}.pdf 2>/dev/null`;

  return await new Promise<NextResponse>((resolve) => {
    const child = spawn(cmd, [], { shell: true });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.on("close", (code) => {
      resolve(
        NextResponse.json({
          ok: code === 0,
          name,
          stdout,
        }),
      );
    });
    child.on("error", () => {
      resolve(
        NextResponse.json(
          { ok: false, name, stdout, error: "spawn failed" },
          { status: 500 },
        ),
      );
    });
  });
}
