import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@bvbe/db";
import { quoteOtc, QUOTE_TTL_MS, type QuoteDb } from "./quote";

const D = (v: string | number) => new Prisma.Decimal(v);

function makeFake(seed: { lastPrice?: Prisma.Decimal | null }) {
  const tickets: Array<{
    id: string;
    userId: string;
    pair: string;
    side: "buy" | "sell";
    amount: Prisma.Decimal;
    quotedPrice: Prisma.Decimal | null;
    quoteExpiresAt: Date | null;
    status: string;
  }> = [];
  let next = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    trade: {
      findFirst: async () =>
        seed.lastPrice === null
          ? null
          : { price: seed.lastPrice ?? D(50_000) },
    },
    otcTicket: {
      create: async ({ data }: { data: (typeof tickets)[number] }) => {
        const row = { ...data, id: `t_${next++}` };
        tickets.push(row);
        return row;
      },
    },
  };

  return { db: db as QuoteDb, tickets };
}

describe("quoteOtc", () => {
  it("produces a buy quote with positive side adjustment", async () => {
    const { db, tickets } = makeFake({ lastPrice: D(50_000) });
    const q = await quoteOtc(
      { userId: "u1", pair: "BTC/USDT", side: "buy", amount: "1" },
      db,
    );
    // last * (1 + (10 + 5)/10_000) = 50_000 * 1.0015 = 50_075
    expect(Number(q.quotedPrice)).toBeGreaterThan(50_000);
    expect(tickets).toHaveLength(1);
  });

  it("sell quote is below the last trade", async () => {
    const { db } = makeFake({ lastPrice: D(50_000) });
    const q = await quoteOtc(
      { userId: "u1", pair: "BTC/USDT", side: "sell", amount: "1" },
      db,
    );
    expect(Number(q.quotedPrice)).toBeLessThan(50_000);
  });

  it("sets quoteExpiresAt ~30s in the future", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-15T12:00:00Z");
    vi.setSystemTime(now);
    const { db } = makeFake({ lastPrice: D(50_000) });
    const q = await quoteOtc(
      { userId: "u1", pair: "BTC/USDT", side: "buy", amount: "1" },
      db,
    );
    expect(q.quoteExpiresAt.getTime()).toBe(now.getTime() + QUOTE_TTL_MS);
    vi.useRealTimers();
  });

  it("rejects amount <= 0", async () => {
    const { db } = makeFake({ lastPrice: D(50_000) });
    await expect(
      quoteOtc(
        { userId: "u1", pair: "BTC/USDT", side: "buy", amount: "0" },
        db,
      ),
    ).rejects.toThrow();
  });

  it("rejects when there is no reference price", async () => {
    const { db } = makeFake({ lastPrice: null });
    await expect(
      quoteOtc(
        { userId: "u1", pair: "BTC/USDT", side: "buy", amount: "1" },
        db,
      ),
    ).rejects.toThrow(/reference price/);
  });

  it("rejects malformed pair", async () => {
    const { db } = makeFake({ lastPrice: D(50_000) });
    await expect(
      quoteOtc({ userId: "u1", pair: "btcusdt", side: "buy", amount: "1" }, db),
    ).rejects.toThrow();
  });
});
