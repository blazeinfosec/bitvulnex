import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import { accrueOnce, type AccrualDb } from "./yield-accrual.js";

const D = (s: string | number) => new Prisma.Decimal(s);

type Pool = {
  asset: string;
  supplied: Prisma.Decimal;
  borrowed: Prisma.Decimal;
  reserve: Prisma.Decimal;
  apyBaseBps: number;
  apySlopeBps: number;
  active: boolean;
  lastAccrual: Date;
};

type Position = {
  id: string;
  pool: string;
  side: "supply" | "borrow";
  status: "open" | "closed";
  principal: Prisma.Decimal;
  accrued: Prisma.Decimal;
};

function makeFake(seed: { pools: Pool[]; positions: Position[] }) {
  const pools = seed.pools.map((p) => ({ ...p }));
  const positions = seed.positions.map((p) => ({ ...p }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    lendingPool: {
      findMany: async () => pools.filter((p) => p.active),
      update: async ({
        where,
        data,
      }: {
        where: { asset: string };
        data: {
          reserve?: { increment: Prisma.Decimal };
          lastAccrual?: Date;
        };
      }) => {
        const p = pools.find((pp) => pp.asset === where.asset);
        if (!p) throw new Error("pool not found");
        if (data.reserve?.increment) {
          p.reserve = p.reserve.add(data.reserve.increment);
        }
        if (data.lastAccrual) p.lastAccrual = data.lastAccrual;
        return p;
      },
    },
    lendingPosition: {
      findMany: async ({
        where,
      }: {
        where: { pool: string; side: string; status: string };
      }) =>
        positions.filter(
          (pp) =>
            pp.pool === where.pool &&
            pp.side === where.side &&
            pp.status === where.status,
        ),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { accrued: { increment: Prisma.Decimal } };
      }) => {
        const pos = positions.find((pp) => pp.id === where.id);
        if (!pos) throw new Error("position not found");
        pos.accrued = pos.accrued.add(data.accrued.increment);
        return pos;
      },
    },
  };

  return { db: db as AccrualDb, pools, positions };
}

describe("accrueOnce", () => {
  it("is a no-op when no time has elapsed", async () => {
    const now = new Date();
    const { db, pools } = makeFake({
      pools: [
        {
          asset: "BTC",
          supplied: D(100),
          borrowed: D(50),
          reserve: D(0),
          apyBaseBps: 200,
          apySlopeBps: 1000,
          active: true,
          lastAccrual: now,
        },
      ],
      positions: [],
    });
    const res = await accrueOnce(db);
    expect(res.pools).toBe(0);
    expect(pools[0]?.reserve.toString()).toBe("0");
  });

  it("supply-only pool: no borrow, no interest emitted", async () => {
    const past = new Date(Date.now() - 60_000);
    const { db, positions, pools } = makeFake({
      pools: [
        {
          asset: "BTC",
          supplied: D(100),
          borrowed: D(0),
          reserve: D(0),
          apyBaseBps: 200,
          apySlopeBps: 1000,
          active: true,
          lastAccrual: past,
        },
      ],
      positions: [
        {
          id: "s1",
          pool: "BTC",
          side: "supply",
          status: "open",
          principal: D(100),
          accrued: D(0),
        },
      ],
    });
    await accrueOnce(db);
    expect(positions[0]?.accrued.toString()).toBe("0");
    expect(pools[0]?.reserve.toString()).toBe("0");
  });

  it("supply + borrow: distributes interest pro-rata across suppliers", async () => {
    const past = new Date(Date.now() - 60_000);
    const { db, positions } = makeFake({
      pools: [
        {
          asset: "USDT",
          supplied: D(1000),
          borrowed: D(500),
          reserve: D(0),
          apyBaseBps: 200,
          apySlopeBps: 1000,
          active: true,
          lastAccrual: past,
        },
      ],
      positions: [
        {
          id: "s1",
          pool: "USDT",
          side: "supply",
          status: "open",
          principal: D(700),
          accrued: D(0),
        },
        {
          id: "s2",
          pool: "USDT",
          side: "supply",
          status: "open",
          principal: D(300),
          accrued: D(0),
        },
        {
          id: "b1",
          pool: "USDT",
          side: "borrow",
          status: "open",
          principal: D(500),
          accrued: D(0),
        },
      ],
    });
    await accrueOnce(db);
    const s1 = positions.find((p) => p.id === "s1");
    const s2 = positions.find((p) => p.id === "s2");
    const b1 = positions.find((p) => p.id === "b1");
    // Both supply positions should have nonzero accrued after a tick.
    expect(Number(s1!.accrued.toString())).toBeGreaterThan(0);
    expect(Number(s2!.accrued.toString())).toBeGreaterThan(0);
    // s1 share = 700/1000 = 0.7; s2 share = 0.3. Ratio should hold.
    const ratio = Number(s1!.accrued.toString()) / Number(s2!.accrued.toString());
    expect(ratio).toBeCloseTo(7 / 3, 4);
    // Borrower paid the full interest.
    expect(Number(b1!.accrued.toString())).toBeGreaterThan(0);
  });

  it("conservation across one tick: credited supply + reserve ≈ borrower interest", async () => {
    const past = new Date(Date.now() - 60_000);
    const { db, positions, pools } = makeFake({
      pools: [
        {
          asset: "USDT",
          supplied: D(1000),
          borrowed: D(500),
          reserve: D(0),
          apyBaseBps: 200,
          apySlopeBps: 1000,
          active: true,
          lastAccrual: past,
        },
      ],
      positions: [
        {
          id: "s1",
          pool: "USDT",
          side: "supply",
          status: "open",
          principal: D(1000),
          accrued: D(0),
        },
        {
          id: "b1",
          pool: "USDT",
          side: "borrow",
          status: "open",
          principal: D(500),
          accrued: D(0),
        },
      ],
    });
    await accrueOnce(db);
    const credited = positions
      .filter((p) => p.side === "supply")
      .reduce((acc, p) => acc.add(p.accrued), D(0));
    const charged = positions
      .filter((p) => p.side === "borrow")
      .reduce((acc, p) => acc.add(p.accrued), D(0));
    const reserveDelta = pools[0]?.reserve ?? D(0);
    // Charged interest equals credited supply + reserve (within decimal precision).
    const totalDistributed = credited.add(reserveDelta);
    const diff = charged.sub(totalDistributed).abs();
    expect(Number(diff.toString())).toBeLessThan(1e-12);
  });
});
