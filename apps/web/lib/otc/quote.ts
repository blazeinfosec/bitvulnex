// OTC desk quote engine. Quotes execute against an opaque "desk
// inventory" pool (architect resolution #2) — the public order book
// is not touched. The matcher itself is fee-agnostic; the caller
// passes whichever feeBps is appropriate for the desk relationship.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export const QUOTE_TTL_MS = 30_000;
export const SIDE_ADJUST_BPS = 10;
export const SIZE_SLIPPAGE_BPS = 5;

export type QuoteArgs = {
  userId: string;
  pair: string;
  side: "buy" | "sell";
  amount: string;
};

export type QuoteDb = Pick<typeof defaultPrisma, "trade" | "otcTicket">;

function adjustmentBps(side: "buy" | "sell", amount: Prisma.Decimal): number {
  const sideAdjust = side === "buy" ? SIDE_ADJUST_BPS : -SIDE_ADJUST_BPS;
  // Slippage scales with sqrt(amount). The unit is 1 base coin.
  const slippage = Math.sqrt(Number(amount.toString())) * SIZE_SLIPPAGE_BPS;
  return sideAdjust + Math.round(slippage);
}

export async function quoteOtc(
  args: QuoteArgs,
  db: QuoteDb = defaultPrisma,
): Promise<{
  ticketId: string;
  quotedPrice: string;
  quoteExpiresAt: Date;
}> {
  if (!/^[A-Z]+\/[A-Z]+$/.test(args.pair)) throw new Error("bad pair");
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) throw new Error("amount must be > 0");

  const lastTrade = await db.trade.findFirst({
    where: { pair: args.pair },
    orderBy: { executedAt: "desc" },
    select: { price: true },
  });
  if (!lastTrade) throw new Error("no reference price for pair");

  const adjBps = adjustmentBps(args.side, amount);
  const adj = new Prisma.Decimal(adjBps).div(10_000);
  const quotedPrice = lastTrade.price.mul(new Prisma.Decimal(1).add(adj));
  const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  const ticket = await db.otcTicket.create({
    data: {
      userId: args.userId,
      pair: args.pair,
      side: args.side,
      amount,
      quotedPrice,
      status: "quoted",
      quoteExpiresAt,
    },
  });

  return {
    ticketId: ticket.id,
    quotedPrice: quotedPrice.toString(),
    quoteExpiresAt,
  };
}
