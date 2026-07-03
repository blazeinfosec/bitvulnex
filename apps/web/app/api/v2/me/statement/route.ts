// Account statement export. Streams the caller's own trade / deposit /
// withdrawal history as CSV so users (and instructors) can pull a full
// activity record. Auth is the standard Bearer-token path; a user only
// ever sees their own rows.

import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/statement",
  summary:
    "Download the authenticated user's trade/deposit/withdrawal history as CSV.",
  responses: { "200": { description: "text/csv" } },
});

export const dynamic = "force-dynamic";

type Row = {
  ts: Date;
  type: string;
  market: string;
  side: string;
  amount: string;
  price: string;
  status: string;
};

function csvCell(v: string): string {
  // Quote anything containing a comma, quote, or newline; double inner quotes.
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const userId = claims.sub;

  const [deposits, withdrawals, trades] = await Promise.all([
    prisma.deposit.findMany({
      where: { userId },
      select: { asset: true, amount: true, seenAt: true, creditedAt: true, status: true },
    }),
    prisma.withdrawal.findMany({
      where: { userId },
      select: { asset: true, amount: true, requestedAt: true, status: true },
    }),
    prisma.trade.findMany({
      where: { OR: [{ takerUserId: userId }, { makerUserId: userId }] },
      select: {
        pair: true,
        amount: true,
        price: true,
        executedAt: true,
        takerUserId: true,
        takerOrder: { select: { side: true } },
        makerOrder: { select: { side: true } },
      },
    }),
  ]);

  const rows: Row[] = [];

  for (const d of deposits) {
    rows.push({
      ts: d.creditedAt ?? d.seenAt,
      type: "deposit",
      market: d.asset,
      side: "",
      amount: d.amount.toString(),
      price: "",
      status: d.status,
    });
  }
  for (const w of withdrawals) {
    rows.push({
      ts: w.requestedAt,
      type: "withdrawal",
      market: w.asset,
      side: "",
      amount: w.amount.toString(),
      price: "",
      status: w.status,
    });
  }
  for (const t of trades) {
    const isTaker = t.takerUserId === userId;
    const side = isTaker ? t.takerOrder.side : t.makerOrder.side;
    rows.push({
      ts: t.executedAt,
      type: isTaker ? "trade (taker)" : "trade (maker)",
      market: t.pair,
      side,
      amount: t.amount.toString(),
      price: t.price.toString(),
      status: "filled",
    });
  }

  rows.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  const header = "timestamp,type,market,side,amount,price,status";
  const lines = rows.map((r) =>
    [
      r.ts.toISOString(),
      r.type,
      r.market,
      r.side,
      r.amount,
      r.price,
      r.status,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header, ...lines].join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="bitvulnex-statement.csv"',
    },
  });
}
