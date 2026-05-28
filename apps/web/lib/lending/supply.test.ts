import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import { supplyToPool, type SupplyDb } from "./supply";

const D = (v: string | number) => new Prisma.Decimal(v);

type BalanceRow = {
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  available: Prisma.Decimal;
};

function makeFake(seed: {
  balances: BalanceRow[];
  pools: Array<{ asset: string; active: boolean; supplied?: string }>;
}) {
  const balances = seed.balances.map((b) => ({ ...b }));
  const pools = seed.pools.map((p) => ({
    asset: p.asset,
    active: p.active,
    supplied: D(p.supplied ?? "0"),
  }));
  const positions: Array<{
    id: string;
    userId: string;
    pool: string;
    side: "supply" | "borrow";
    principal: Prisma.Decimal;
  }> = [];
  let nextId = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    balance: {
      findUnique: async ({
        where,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
      }) =>
        balances.find(
          (b) =>
            b.userId === where.userId_asset.userId &&
            b.asset === where.userId_asset.asset,
        ) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        data: {
          available?: { decrement?: Prisma.Decimal };
          amount?: { decrement?: Prisma.Decimal };
        };
      }) => {
        const b = balances.find(
          (bb) =>
            bb.userId === where.userId_asset.userId &&
            bb.asset === where.userId_asset.asset,
        );
        if (!b) throw new Error("balance not found");
        if (data.available?.decrement)
          b.available = b.available.sub(data.available.decrement);
        if (data.amount?.decrement)
          b.amount = b.amount.sub(data.amount.decrement);
        return b;
      },
    },
    lendingPool: {
      findUnique: async ({ where }: { where: { asset: string } }) =>
        pools.find((p) => p.asset === where.asset) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { asset: string };
        data: { supplied: { increment: Prisma.Decimal } };
      }) => {
        const p = pools.find((pp) => pp.asset === where.asset);
        if (!p) throw new Error("pool not found");
        p.supplied = p.supplied.add(data.supplied.increment);
        return p;
      },
    },
    lendingPosition: {
      create: async ({ data }: { data: Omit<(typeof positions)[number], "id"> }) => {
        const row = { id: `pos_${nextId++}`, ...data };
        positions.push(row);
        return row;
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return { db: db as SupplyDb, balances, pools, positions };
}

describe("supplyToPool", () => {
  it("locks balance and creates a supply position", async () => {
    const { db, balances, pools, positions } = makeFake({
      balances: [
        { userId: "u1", asset: "BTC", amount: D(10), available: D(10) },
      ],
      pools: [{ asset: "BTC", active: true }],
    });
    const { positionId } = await supplyToPool(
      { userId: "u1", asset: "BTC", amount: "3" },
      db,
    );
    expect(positionId).toMatch(/^pos_/);
    expect(balances[0]?.available.toString()).toBe("7");
    expect(balances[0]?.amount.toString()).toBe("7");
    expect(pools[0]?.supplied.toString()).toBe("3");
    expect(positions).toHaveLength(1);
    expect(positions[0]?.principal.toString()).toBe("3");
  });

  it("rejects insufficient balance", async () => {
    const { db } = makeFake({
      balances: [
        { userId: "u1", asset: "BTC", amount: D(1), available: D(1) },
      ],
      pools: [{ asset: "BTC", active: true }],
    });
    await expect(
      supplyToPool({ userId: "u1", asset: "BTC", amount: "5" }, db),
    ).rejects.toThrow(/insufficient/);
  });

  it("rejects an inactive pool", async () => {
    const { db } = makeFake({
      balances: [
        { userId: "u1", asset: "BTC", amount: D(10), available: D(10) },
      ],
      pools: [{ asset: "BTC", active: false }],
    });
    await expect(
      supplyToPool({ userId: "u1", asset: "BTC", amount: "1" }, db),
    ).rejects.toThrow(/not available/);
  });

  it("rejects unknown asset", async () => {
    const { db } = makeFake({
      balances: [],
      pools: [],
    });
    await expect(
      supplyToPool({ userId: "u1", asset: "FAKE", amount: "1" }, db),
    ).rejects.toThrow(/unknown asset/);
  });
});
