import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  computeUserEquity,
  snapshotOnce,
  startOfUtcDay,
  type EquitySnapshotDb,
} from "./equity-snapshot.js";

const D = (s: string | number) => new Prisma.Decimal(s);

type BalanceRow = {
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  marginAvailable: Prisma.Decimal;
};

type LendingRow = {
  userId: string;
  pool: string;
  side: "supply" | "borrow";
  status: "open" | "closed";
  principal: Prisma.Decimal;
  accrued: Prisma.Decimal;
};

type StakingRow = {
  userId: string;
  asset: string;
  status: "active" | "unstaking" | "ended";
  principal: Prisma.Decimal;
};

type MarginRow = {
  userId: string;
  pair: string;
  side: "long" | "short";
  status: "open" | "closed";
  size: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  collateral: Prisma.Decimal;
  collateralAsset: string;
};

type TradeRow = {
  pair: string;
  price: Prisma.Decimal;
  executedAt: Date;
};

type SnapshotRow = {
  userId: string;
  date: Date;
  totalUsd: Prisma.Decimal;
};

interface Seed {
  users: { id: string }[];
  balances: BalanceRow[];
  lending: LendingRow[];
  staking: StakingRow[];
  margin: MarginRow[];
  trades: TradeRow[];
}

function makeFake(seed: Seed) {
  const snapshots: SnapshotRow[] = [];

  function lastTradeFor(pair: string): TradeRow | null {
    const matching = seed.trades.filter((t) => t.pair === pair);
    if (matching.length === 0) return null;
    return matching.sort(
      (a, b) => b.executedAt.getTime() - a.executedAt.getTime(),
    )[0]!;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user: {
      findMany: async () => seed.users.map((u) => ({ id: u.id })),
    },
    balance: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        seed.balances.filter((b) => b.userId === where.userId),
    },
    trade: {
      findFirst: async ({ where }: { where: { pair: string } }) =>
        lastTradeFor(where.pair),
    },
    lendingPosition: {
      findMany: async ({
        where,
      }: {
        where: { userId: string; status: string };
      }) =>
        seed.lending.filter(
          (lp) => lp.userId === where.userId && lp.status === where.status,
        ),
    },
    stakingPosition: {
      findMany: async ({
        where,
      }: {
        where: { userId: string; status: string };
      }) =>
        seed.staking.filter(
          (sp) => sp.userId === where.userId && sp.status === where.status,
        ),
    },
    marginPosition: {
      findMany: async ({
        where,
      }: {
        where: { userId: string; status: string };
      }) =>
        seed.margin.filter(
          (mp) => mp.userId === where.userId && mp.status === where.status,
        ),
    },
    equitySnapshot: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string };
      }) =>
        snapshots.find((s) => s.userId === where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_date: { userId: string; date: Date } };
        create: { userId: string; date: Date; totalUsd: Prisma.Decimal };
        update: { totalUsd: Prisma.Decimal; computedAt: Date };
      }) => {
        const existing = snapshots.find(
          (s) =>
            s.userId === where.userId_date.userId &&
            s.date.getTime() === where.userId_date.date.getTime(),
        );
        if (existing) {
          existing.totalUsd = update.totalUsd;
          return existing;
        }
        const row: SnapshotRow = {
          userId: create.userId,
          date: create.date,
          totalUsd: create.totalUsd,
        };
        snapshots.push(row);
        return row;
      },
    },
  };

  return { db: db as EquitySnapshotDb, snapshots };
}

describe("computeUserEquity", () => {
  it("spot-only user: sums balance × USDT price across assets", async () => {
    const { db } = makeFake({
      users: [{ id: "u1" }],
      balances: [
        {
          userId: "u1",
          asset: "BTC",
          amount: D("0.5"),
          marginAvailable: D("0"),
        },
        {
          userId: "u1",
          asset: "USDT",
          amount: D("1000"),
          marginAvailable: D("0"),
        },
        {
          userId: "u1",
          asset: "USDC",
          amount: D("500"),
          marginAvailable: D("0"),
        },
      ],
      lending: [],
      staking: [],
      margin: [],
      trades: [
        {
          pair: "BTC/USDT",
          price: D("60000"),
          executedAt: new Date("2026-05-29T00:00:00Z"),
        },
      ],
    });
    const total = await computeUserEquity("u1", db);
    // 0.5 BTC * 60000 + 1000 USDT * 1 + 500 USDC * 1 = 30000 + 1500
    expect(total.toString()).toBe("31500");
  });

  it("lending supply position: includes principal + accrued", async () => {
    const { db } = makeFake({
      users: [{ id: "u1" }],
      balances: [
        {
          userId: "u1",
          asset: "USDT",
          amount: D("100"),
          marginAvailable: D("0"),
        },
      ],
      lending: [
        {
          userId: "u1",
          pool: "USDT",
          side: "supply",
          status: "open",
          principal: D("400"),
          accrued: D("10"),
        },
        // Closed positions are ignored.
        {
          userId: "u1",
          pool: "USDT",
          side: "supply",
          status: "closed",
          principal: D("9999"),
          accrued: D("0"),
        },
      ],
      staking: [],
      margin: [],
      trades: [],
    });
    const total = await computeUserEquity("u1", db);
    // 100 spot + (400 + 10) supply = 510
    expect(total.toString()).toBe("510");
  });

  it("open long margin position: includes collateral + unrealized P&L", async () => {
    const { db } = makeFake({
      users: [{ id: "u1" }],
      balances: [
        // Pretend the user opened a position with the collateral
        // already moved out — marginAvailable now 0.
        {
          userId: "u1",
          asset: "USDT",
          amount: D("0"),
          marginAvailable: D("0"),
        },
      ],
      lending: [],
      staking: [],
      margin: [
        {
          userId: "u1",
          pair: "BTC/USDT",
          side: "long",
          status: "open",
          size: D("0.1"),
          entryPrice: D("60000"),
          collateral: D("600"),
          collateralAsset: "USDT",
        },
      ],
      trades: [
        // Mark price moved up from 60000 → 65000 → +500 P&L on 0.1 BTC
        {
          pair: "BTC/USDT",
          price: D("65000"),
          executedAt: new Date("2026-05-29T00:01:00Z"),
        },
      ],
    });
    const total = await computeUserEquity("u1", db);
    // collateral 600 + P&L (0.1 * (65000 - 60000)) = 600 + 500 = 1100
    expect(total.toString()).toBe("1100");
  });

  it("ignores assets with no derivable USDT price", async () => {
    const { db } = makeFake({
      users: [{ id: "u1" }],
      balances: [
        {
          userId: "u1",
          asset: "FOO", // no FOO/USDT trade → price 0 → ignored
          amount: D("1000"),
          marginAvailable: D("0"),
        },
        {
          userId: "u1",
          asset: "USDT",
          amount: D("50"),
          marginAvailable: D("0"),
        },
      ],
      lending: [],
      staking: [],
      margin: [],
      trades: [],
    });
    const total = await computeUserEquity("u1", db);
    expect(total.toString()).toBe("50");
  });
});

describe("snapshotOnce", () => {
  it("upserts one snapshot per user at the start of UTC day", async () => {
    const now = new Date("2026-05-29T14:23:45Z");
    const day = startOfUtcDay(now);
    const { db, snapshots } = makeFake({
      users: [{ id: "u1" }, { id: "u2" }],
      balances: [
        {
          userId: "u1",
          asset: "USDT",
          amount: D("100"),
          marginAvailable: D("0"),
        },
        {
          userId: "u2",
          asset: "USDT",
          amount: D("200"),
          marginAvailable: D("0"),
        },
      ],
      lending: [],
      staking: [],
      margin: [],
      trades: [],
    });
    const res = await snapshotOnce(db, now);
    expect(res.users).toBe(2);
    expect(snapshots.length).toBe(2);
    const u1 = snapshots.find((s) => s.userId === "u1");
    expect(u1?.date.getTime()).toBe(day.getTime());
    expect(u1?.totalUsd.toString()).toBe("100");
    // Re-running for the same day updates instead of inserting.
    await snapshotOnce(db, now);
    expect(snapshots.length).toBe(2);
  });

  it("skips zero-equity users that have no prior snapshot", async () => {
    const now = new Date("2026-05-29T14:23:45Z");
    const { db, snapshots } = makeFake({
      users: [{ id: "u1" }, { id: "u2" }],
      balances: [
        // u1 has funds; u2 has nothing.
        {
          userId: "u1",
          asset: "USDT",
          amount: D("100"),
          marginAvailable: D("0"),
        },
      ],
      lending: [],
      staking: [],
      margin: [],
      trades: [],
    });
    const res = await snapshotOnce(db, now);
    expect(res.users).toBe(1);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.userId).toBe("u1");
  });

  it("keeps writing a zero-equity row once the user has a prior snapshot", async () => {
    const now1 = new Date("2026-05-29T14:23:45Z");
    const now2 = new Date("2026-05-30T14:23:45Z");
    const balances: BalanceRow[] = [
      {
        userId: "u1",
        asset: "USDT",
        amount: D("100"),
        marginAvailable: D("0"),
      },
    ];
    const { db, snapshots } = makeFake({
      users: [{ id: "u1" }],
      balances,
      lending: [],
      staking: [],
      margin: [],
      trades: [],
    });
    await snapshotOnce(db, now1);
    expect(snapshots.length).toBe(1);
    // u1 now has $0 — but a prior snapshot exists, so we keep recording.
    balances.length = 0;
    await snapshotOnce(db, now2);
    expect(snapshots.length).toBe(2);
    expect(snapshots[1]!.totalUsd.toString()).toBe("0");
  });
});
