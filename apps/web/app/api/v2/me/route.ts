import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";
import { maybeEmitFlag } from "@/lib/ctf/emit";

registerEndpoint({
  method: "get",
  path: "/api/v2/me",
  summary: "Return the authenticated user's profile",
  responses: {
    "200": { description: "Profile" },
    "401": { description: "Auth required" },
  },
});
registerEndpoint({
  method: "patch",
  path: "/api/v2/me",
  summary: "Partial update of the authenticated user's profile",
  responses: {
    "200": { description: "Updated profile" },
    "400": { description: "Invalid body" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
      emailVerified: true,
      totpEnabled: true,
      createdAt: true,
    },
  });
  if (!user) return jsonError(401, "unauthorized");

  return NextResponse.json(user);
}

const patchSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().max(64).optional(),
  role: z.string().optional(),
  kycTier: z.number().int().min(0).max(3).optional(),
  feeTier: z.string().optional(),
});

export async function PATCH(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, patchSchema);
  if (parsed.error) return parsed.error;

  // Apply the partial update to the caller's own user row. The JWT
  // `sub` claim constrains the row; the validated body is forwarded
  // verbatim to Prisma for the column-level update. Cast through
  // Prisma.UserUpdateInput because the zod-inferred type widens the
  // Role enum to `string` (zod 3 has no first-class enum-from-prisma
  // helper).
  const updated = await prisma.user.update({
    where: { id: claims.sub },
    data: parsed.data as Prisma.UserUpdateInput,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      kycTier: true,
    },
  });
  const wroteRestrictedField =
    "role" in parsed.data ||
    "kycTier" in parsed.data ||
    "feeTier" in parsed.data;
  const body = wroteRestrictedField
    ? maybeEmitFlag({ user: updated }, "V-51")
    : { user: updated };
  return NextResponse.json(body);
}
