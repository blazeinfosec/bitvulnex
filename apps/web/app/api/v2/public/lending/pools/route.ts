import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { registerEndpoint } from "@/lib/openapi-registry";
import { perSecondRate, utilization } from "@bvbe/shared";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/lending/pools",
  summary: "List lending pools with current utilization and effective APY",
  responses: { "200": { description: "OK" } },
});

export const dynamic = "force-dynamic";

export async function GET() {
  const pools = await prisma.lendingPool.findMany({
    where: { active: true },
    orderBy: { asset: "asc" },
  });
  const rows = pools.map((p) => {
    const u = utilization(p.supplied, p.borrowed);
    const cappedU = u.gt(1) ? new Prisma.Decimal(1) : u;
    const effectiveBps = Math.round(
      p.apyBaseBps + Number(cappedU.toString()) * p.apySlopeBps,
    );
    return {
      asset: p.asset,
      supplied: p.supplied.toString(),
      borrowed: p.borrowed.toString(),
      utilization: cappedU.toString(),
      apyBaseBps: p.apyBaseBps,
      apySlopeBps: p.apySlopeBps,
      effectiveApyBps: effectiveBps,
      perSecondRate: perSecondRate(effectiveBps).toString(),
    };
  });
  return NextResponse.json({ pools: rows });
}
