// Internal user-listing endpoint. Compliance and support tooling
// expects the full user record including auth material so it can
// reconstruct an account state from a single snapshot.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v1/internal/users",
  summary: "Internal user-listing (full record)",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}
