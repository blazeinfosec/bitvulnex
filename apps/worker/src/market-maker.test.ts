import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  nextPrice,
  normalSample,
  roundToTick,
  runMarketMakerTick,
  type MmDb,
  type MmPubSub,
} from "./market-maker.js";

const D = (s: string | number) => new Prisma.Decimal(s);

// Deterministic PRNG for repeatable property tests.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type OrderRow = {
  id: number;
  userId: string;
  pair: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "stop_limit" | "oco";
  price: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  filled: Prisma.Decimal;
  status: "open" | "partial" | "filled" | "cancelled";
  feeTier: string;
  createdAt: Date;
  cancelledAt: Date | null;
};

type TradeRow = {
  id: number;
  pair: string;
  takerOrderId: number;
  makerOrderId: number;
  takerUserId: string;
  makerUserId: string;
  price: Prisma.Decimal;
  amount: Prisma.Decimal;
  takerFeeBps: number;
  makerFeeBps: number;
  executedAt: Date;
};

type BalanceRow = {
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  available: Prisma.Decimal;
  locked: Prisma.Decimal;
};

function makeFake() {
  const orders: OrderRow[] = [];
  const trades: TradeRow[] = [];
  const balances: BalanceRow[] = [];
  let nextOrderId = 1;
  let nextTradeId = 1;
  const pairs = [
    {
      base: "BTC",
      quote: "USDT",
      active: true,
      minOrderSize: D("0.0001"),
      priceTick: D("0.01"),
    },
  ];
  const users = [
    { id: "u_alpha", email: "mm.alpha@bvbe.local" },
    { id: "u_beta", email: "mm.beta@bvbe.local" },
  ];

  // Seed generous starting balances for both MMs.
  for (const u of users) {
    for (const asset of ["BTC", "USDT"]) {
      balances.push({
        userId: u.id,
        asset,
        amount: D("1000000"),
        available: D("1000000"),
        locked: D("0"),
      });
    }
  }

  const findBal = (userId: string, asset: string) =>
    balances.find((b) => b.userId === userId && b.asset === asset);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    tradingPair: {
      findMany: async ({ where }: { where?: { active?: boolean } } = {}) =>
        where?.active === true ? pairs.filter((p) => p.active) : pairs,
    },
    trade: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { pair: string; executedAt?: { gte: Date } };
        orderBy: { executedAt: "asc" | "desc" };
      }) => {
        const filtered = trades.filter(
          (t) =>
            t.pair === where.pair &&
            (!where.executedAt?.gte || t.executedAt >= where.executedAt.gte),
        );
        filtered.sort((a, b) =>
          orderBy.executedAt === "desc"
            ? b.executedAt.getTime() - a.executedAt.getTime()
            : a.executedAt.getTime() - b.executedAt.getTime(),
        );
        return filtered[0] ?? null;
      },
      findMany: async ({
        where,
      }: {
        where: { pair: string; executedAt?: { gte: Date } };
      }) =>
        trades.filter(
          (t) =>
            t.pair === where.pair &&
            (!where.executedAt?.gte || t.executedAt >= where.executedAt.gte),
        ),
      create: async ({ data }: { data: Omit<TradeRow, "id" | "executedAt"> }) => {
        const row: TradeRow = {
          id: nextTradeId++,
          ...data,
          price: data.price as Prisma.Decimal,
          amount: D(data.amount as unknown as string),
          executedAt: new Date(),
        };
        trades.push(row);
        return row;
      },
    },
    order: {
      create: async ({
        data,
        select,
      }: {
        data: Omit<OrderRow, "id" | "createdAt" | "cancelledAt">;
        select?: { id?: boolean };
      }) => {
        const row: OrderRow = {
          id: nextOrderId++,
          ...data,
          price: data.price ?? null,
          amount: D(data.amount as unknown as string),
          filled: D(data.filled as unknown as string),
          createdAt: new Date(),
          cancelledAt: null,
        };
        orders.push(row);
        return select?.id ? { id: row.id } : row;
      },
      createMany: async ({
        data,
      }: {
        data: Array<Omit<OrderRow, "id" | "createdAt" | "cancelledAt">>;
      }) => {
        for (const d of data) {
          orders.push({
            id: nextOrderId++,
            ...d,
            price: d.price ?? null,
            amount: D(d.amount as unknown as string),
            filled: D(d.filled as unknown as string),
            createdAt: new Date(),
            cancelledAt: null,
          });
        }
        return { count: data.length };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          pair: string;
          userId: { in: string[] };
          status: { in: string[] };
          createdAt: { lt: Date };
        };
        data: { status: string; cancelledAt: Date };
      }) => {
        let n = 0;
        for (const o of orders) {
          if (
            o.pair === where.pair &&
            where.userId.in.includes(o.userId) &&
            where.status.in.includes(o.status) &&
            o.createdAt < where.createdAt.lt
          ) {
            o.status = data.status as OrderRow["status"];
            o.cancelledAt = data.cancelledAt;
            n++;
          }
        }
        return { count: n };
      },
    },
    balance: {
      update: async ({
        where,
        data,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        data: {
          available?: { increment?: Prisma.Decimal | string; decrement?: Prisma.Decimal | string };
          amount?: { increment?: Prisma.Decimal | string; decrement?: Prisma.Decimal | string };
        };
      }) => {
        const b = findBal(where.userId_asset.userId, where.userId_asset.asset);
        if (!b) throw new Error(`balance missing: ${where.userId_asset.userId}/${where.userId_asset.asset}`);
        if (data.available?.increment) b.available = b.available.add(D(data.available.increment as unknown as string));
        if (data.available?.decrement) b.available = b.available.sub(D(data.available.decrement as unknown as string));
        if (data.amount?.increment) b.amount = b.amount.add(D(data.amount.increment as unknown as string));
        if (data.amount?.decrement) b.amount = b.amount.sub(D(data.amount.decrement as unknown as string));
        return b;
      },
    },
    user: {
      findUnique: async ({
        where,
        select: _select,
      }: {
        where: { email: string };
        select?: { id?: boolean };
      }) => {
        const u = users.find((x) => x.email === where.email);
        return u ? { id: u.id } : null;
      },
    },
  };

  return { db: db as MmDb, orders, trades, balances };
}

describe("normalSample", () => {
  it("produces samples with mean ≈ 0 and stdev ≈ sigma over N=10k", () => {
    const rng = mulberry32(42);
    const N = 10_000;
    const sigma = 0.01;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) samples.push(normalSample(sigma, rng));
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / N;
    const stdev = Math.sqrt(variance);
    expect(Math.abs(mean)).toBeLessThan(sigma * 0.1);
    expect(Math.abs(stdev - sigma)).toBeLessThan(sigma * 0.1);
  });
});

describe("roundToTick", () => {
  it("rounds prices to the nearest multiple of the tick", () => {
    expect(roundToTick(D("67234.567"), D("0.01")).toString()).toBe("67234.57");
    expect(roundToTick(D("0.0010234"), D("0.000001")).toString()).toBe("0.001023");
  });
});

describe("nextPrice (price walk math)", () => {
  it("price walk has bounded drift over N=1000 ticks", () => {
    const rng = mulberry32(7);
    const start = D("67000");
    const sigma = 0.0005;
    const tick = D("0.01");
    let p = start;
    for (let i = 0; i < 1000; i++) {
      p = nextPrice(p, sigma, tick, rng);
    }
    // With sigma=0.0005 and 1000 steps, the log-return random walk has
    // stdev sqrt(1000)*0.0005 ≈ 0.0158, so the price should land
    // within roughly ±10% with overwhelming probability. We give
    // ourselves a wide envelope (±30%) so the test never flakes on
    // genuinely-rare RNG paths while still catching outright drift bugs
    // (e.g., an off-by-one that multiplies sigma every tick).
    const ratio = Number(p.toString()) / Number(start.toString());
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });

  it("always rounds to a multiple of the price tick", () => {
    const rng = mulberry32(123);
    const tick = D("0.01");
    let p = D("67000");
    for (let i = 0; i < 100; i++) {
      p = nextPrice(p, 0.001, tick, rng);
      // Check by reading the decimal string — last 2 chars must be a
      // multiple of the tick. Convert to integer cents.
      const cents = Number(p.toString()) * 100;
      expect(Math.abs(cents - Math.round(cents))).toBeLessThan(1e-6);
    }
  });
});

describe("runMarketMakerTick", () => {
  it("writes a synthetic Trade row between the two MM users", async () => {
    const { db, trades } = makeFake();
    const captured: Array<{ channel: string; message: string }> = [];
    const pub: MmPubSub = {
      publish: async (channel: string, message: string) => {
        captured.push({ channel, message });
        return 1;
      },
    };
    const rng = mulberry32(99);
    await runMarketMakerTick(db, pub, rng);
    expect(trades.length).toBeGreaterThanOrEqual(1);
    const t = trades[0];
    if (!t) throw new Error("trade missing");
    expect(t.takerUserId).not.toBe(t.makerUserId);
    expect([t.takerUserId, t.makerUserId].sort()).toEqual(["u_alpha", "u_beta"]);
    expect(t.takerFeeBps).toBe(0);
    expect(t.makerFeeBps).toBe(0);
    // Pub/sub: at least book / trades / ticker:all channels.
    const channels = captured.map((c) => c.channel);
    expect(channels).toContain("book:BTC/USDT");
    expect(channels).toContain("trades:BTC/USDT");
    expect(channels).toContain("ticker:all");
  });

  it("refreshes 5 bids + 5 asks at tick-aligned prices around the mid", async () => {
    const { db, orders } = makeFake();
    const rng = mulberry32(1234);
    await runMarketMakerTick(db, null, rng);
    const openBids = orders.filter(
      (o) => o.pair === "BTC/USDT" && o.side === "buy" && o.status === "open",
    );
    const openAsks = orders.filter(
      (o) => o.pair === "BTC/USDT" && o.side === "sell" && o.status === "open",
    );
    expect(openBids.length).toBe(5);
    expect(openAsks.length).toBe(5);
    // Every price must be a multiple of the priceTick (0.01).
    for (const o of [...openBids, ...openAsks]) {
      expect(o.price).not.toBeNull();
      const p = Number((o.price as Prisma.Decimal).toString());
      const cents = p * 100;
      expect(Math.abs(cents - Math.round(cents))).toBeLessThan(1e-6);
    }
  });

  it("is a no-op when MM seed users are missing", async () => {
    const { db } = makeFake();
    // Swap user lookup to never resolve.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).user.findUnique = async () => null;
    const res = await runMarketMakerTick(db, null, mulberry32(1));
    expect(res.pairs).toBe(0);
  });

  it("publishes book levels in {price, remaining} shape (matches REST contract)", async () => {
    const { db } = makeFake();
    const captured: Array<{ channel: string; message: string }> = [];
    const pub: MmPubSub = {
      publish: async (channel: string, message: string) => {
        captured.push({ channel, message });
        return 1;
      },
    };
    await runMarketMakerTick(db, pub, mulberry32(7));
    const bookMsg = captured.find((c) => c.channel === "book:BTC/USDT");
    if (!bookMsg) throw new Error("book channel not published");
    const payload = JSON.parse(bookMsg.message) as {
      kind: string;
      bids: Array<Record<string, unknown>>;
      asks: Array<Record<string, unknown>>;
    };
    expect(payload.kind).toBe("book");
    expect(payload.bids.length).toBeGreaterThan(0);
    for (const lvl of [...payload.bids, ...payload.asks]) {
      expect(typeof lvl.price).toBe("string");
      expect(typeof lvl.remaining).toBe("string");
      expect("amount" in lvl).toBe(false); // legacy field must be gone
    }
  });

  it("publishes trades in the {kind:trade, trade:{id,price,size,executedAt,takerSide}} envelope", async () => {
    const { db } = makeFake();
    const captured: Array<{ channel: string; message: string }> = [];
    const pub: MmPubSub = {
      publish: async (channel: string, message: string) => {
        captured.push({ channel, message });
        return 1;
      },
    };
    await runMarketMakerTick(db, pub, mulberry32(11));
    const tradeMsg = captured.find((c) => c.channel === "trades:BTC/USDT");
    if (!tradeMsg) throw new Error("trades channel not published");
    const payload = JSON.parse(tradeMsg.message) as {
      kind: string;
      trade?: Record<string, unknown>;
    };
    expect(payload.kind).toBe("trade");
    expect(payload.trade).toBeTruthy();
    const t = payload.trade as Record<string, unknown>;
    expect(typeof t.id).toBe("string");
    expect(typeof t.price).toBe("number");
    expect(typeof t.size).toBe("number");
    expect(typeof t.executedAt).toBe("number");
    expect(["buy", "sell"]).toContain(t.takerSide as string);
  });
});
