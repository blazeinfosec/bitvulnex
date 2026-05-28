// Pure matching-engine functions. No Prisma imports, no I/O — easy
// to unit-test. The orchestrator (`place.ts`) wraps this in a DB
// transaction.

import { Prisma } from "@bvbe/db";

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

export type RestingOrder = {
  id: number;
  userId: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "stop_limit" | "oco";
  price: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  filled: Prisma.Decimal;
};

export type IncomingOrder = {
  side: "buy" | "sell";
  type: "limit" | "market" | "stop_limit" | "oco";
  price: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  userId: string;
};

export type Match = {
  makerOrderId: number;
  makerUserId: string;
  price: Prisma.Decimal;
  amount: Prisma.Decimal;
};

/**
 * Match an incoming order against a sorted book of resting orders
 * (best price first). Returns the list of matches and the
 * remaining unfilled amount on the incoming order.
 *
 * Price-time priority is the caller's responsibility — pass the
 * book sorted by (price asc for buy side resting, price desc for
 * sell side resting), then createdAt asc within each price level.
 */
export function matchAgainstBook(
  taker: IncomingOrder,
  restingBook: RestingOrder[],
): { matches: Match[]; remaining: Prisma.Decimal } {
  const matches: Match[] = [];
  let remaining = taker.amount;

  for (const resting of restingBook) {
    if (remaining.lte(0)) break;
    if (!crosses(taker, resting)) break;

    const restingRemaining = resting.amount.sub(resting.filled);
    if (restingRemaining.lte(0)) continue;

    const tradeAmount = D(
      Prisma.Decimal.min(remaining, restingRemaining).toString(),
    );
    const tradePrice = resting.price ?? D(0);

    matches.push({
      makerOrderId: resting.id,
      makerUserId: resting.userId,
      price: tradePrice,
      amount: tradeAmount,
    });
    remaining = remaining.sub(tradeAmount);
  }

  return { matches, remaining };
}

function crosses(taker: IncomingOrder, resting: RestingOrder): boolean {
  if (resting.side === taker.side) return false;
  if (resting.price === null) return false;
  if (taker.type === "market") return true;
  if (taker.price === null) return false;
  if (taker.side === "buy") return taker.price.gte(resting.price);
  return taker.price.lte(resting.price);
}

/** Sort a resting book so the best-priced orders come first. */
export function sortBook(book: RestingOrder[], takerSide: "buy" | "sell"): RestingOrder[] {
  return [...book].sort((a, b) => {
    if (!a.price || !b.price) return 0;
    // Buy taker matches against sell resting; lowest sell price first.
    // Sell taker matches against buy resting; highest buy price first.
    const cmp = takerSide === "buy"
      ? a.price.cmp(b.price)
      : b.price.cmp(a.price);
    if (cmp !== 0) return cmp;
    return a.id - b.id; // FIFO within price level
  });
}
