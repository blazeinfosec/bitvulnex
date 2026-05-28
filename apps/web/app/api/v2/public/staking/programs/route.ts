import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/staking/programs",
  summary: "List active staking programs",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET() {
  const programs = await prisma.stakingProgram.findMany({
    where: { active: true },
    orderBy: { asset: "asc" },
  });
  return NextResponse.json({ programs });
}
