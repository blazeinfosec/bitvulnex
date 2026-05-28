import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  pollLiquidations,
  type LiquidationDb,
  type PriceClient,
} from "./liquidation-watcher.js";

// Hand-rolled in-memory fake of the Prisma subset the watcher uses.
// Same pattern as deposit-watcher.test.ts (Phase-3 Q-3.2 resolution).

const D = (s: string) => new Prisma.Decimal(s);

type Position = {
  id: number;
  pair: string;
  status: "open" | "liquidated" | "closed";
  side: "long" | "short";
  size: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  collateral: Prisma.Decimal;
};
type LiquidationRow = {
  id: number;
  positionId: number;
  triggerPrice: Prisma.Decimal;
  keeperRebate: Prisma.Decimal;
};

function makeFake(seed: {
  pairs: Array<{ base: string; quote: string }>;
  positions: Position[];
}) {
  const liqs: LiquidationRow[] = [];
  let nextLiqId = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    tradingPair: {
      findMany: async () => seed.pairs.map((p) => ({ ...p, active: true })),
    },
    marginPosition: {
      findMany: async ({ where }: { where: { pair: string; status: "open" } }) =>
        seed.positions.filter(
          (p) => p.pair === where.pair && p.status === where.status,
        ),
    },
    liquidation: {
      findUnique: async ({ where }: { where: { positionId: number } }) =>
        liqs.find((l) => l.positionId === where.positionId) ?? null,
      create: async ({ data }: { data: Omit<LiquidationRow, "id"> }) => {
        const row: LiquidationRow = { id: nextLiqId++, ...data };
        liqs.push(row);
        return row;
      },
    },
  };

  return { db: db as LiquidationDb, liqs };
}

function staticPricer(prices: Record<string, string | null>): PriceClient {
  return {
    getPrice: async (pair: string) => ({ last: prices[pair] ?? null }),
  };
}

describe("pollLiquidations", () => {
  it("flags an open long position when mark drops below liquidation price", async () => {
    const { db, liqs } = makeFake({
      pairs: [{ base: "BTC", quote: "USDT" }],
      positions: [
        {
          id: 1,
          pair: "BTC/USDT",
          status: "open",
          side: "long",
          size: D("1"),
          entryPrice: D("50000"),
          collateral: D("10000"),
        },
      ],
    });

    await pollLiquidations(
      staticPricer({ "BTC/USDT": "40000" }),
      db,
    );

    expect(liqs).toHaveLength(1);
    expect(liqs[0]?.positionId).toBe(1);
    expect(Number(liqs[0]?.triggerPrice)).toBe(40000);
  });

  it("does NOT flag a position whose mark is comfortably above liquidation", async () => {
    const { db, liqs } = makeFake({
      pairs: [{ base: "BTC", quote: "USDT" }],
      positions: [
        {
          id: 2,
          pair: "BTC/USDT",
          status: "open",
          side: "long",
          size: D("1"),
          entryPrice: D("50000"),
          collateral: D("10000"),
        },
      ],
    });

    await pollLiquidations(
      staticPricer({ "BTC/USDT": "51000" }),
      db,
    );
    expect(liqs).toHaveLength(0);
  });

  it("does not double-flag a position that already has a Liquidation row", async () => {
    const { db, liqs } = makeFake({
      pairs: [{ base: "BTC", quote: "USDT" }],
      positions: [
        {
          id: 3,
          pair: "BTC/USDT",
          status: "open",
          side: "long",
          size: D("1"),
          entryPrice: D("50000"),
          collateral: D("10000"),
        },
      ],
    });

    await pollLiquidations(staticPricer({ "BTC/USDT": "40000" }), db);
    await pollLiquidations(staticPricer({ "BTC/USDT": "40000" }), db);
    expect(liqs).toHaveLength(1);
  });

  it("skips pairs the pricer cannot quote (null last)", async () => {
    const { db, liqs } = makeFake({
      pairs: [{ base: "BTC", quote: "USDT" }],
      positions: [
        {
          id: 4,
          pair: "BTC/USDT",
          status: "open",
          side: "long",
          size: D("1"),
          entryPrice: D("50000"),
          collateral: D("10000"),
        },
      ],
    });
    await pollLiquidations(staticPricer({ "BTC/USDT": null }), db);
    expect(liqs).toHaveLength(0);
  });
});
