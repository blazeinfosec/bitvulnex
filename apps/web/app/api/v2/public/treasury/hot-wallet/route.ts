import { NextResponse } from "next/server";
import { Prisma, prisma } from "@bvbe/db";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/public/treasury/hot-wallet",
  summary: "Aggregate hot-wallet flow summary",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Validation" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";
  if (!/^[A-Z]+$/.test(asset)) return jsonError(400, "bad asset");

  const [deposits, withdrawals] = await Promise.all([
    prisma.deposit.aggregate({
      where: { asset, status: "credited" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.withdrawal.aggregate({
      where: { asset, status: { in: ["broadcast", "confirming", "confirmed"] } },
      _sum: { amount: true, fee: true },
      _count: true,
    }),
  ]);

  const D = (v: Prisma.Decimal | null | undefined) =>
    (v ?? new Prisma.Decimal(0)).toString();

  return NextResponse.json({
    asset,
    deposits: {
      count: deposits._count,
      total: D(deposits._sum.amount),
    },
    withdrawals: {
      count: withdrawals._count,
      total: D(withdrawals._sum.amount),
      fees: D(withdrawals._sum.fee),
    },
  });
}
