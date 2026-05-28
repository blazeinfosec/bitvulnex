import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import { acceptOtc, type AcceptDb } from "./accept";

const D = (v: string | number) => new Prisma.Decimal(v);

type BalanceRow = {
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  available: Prisma.Decimal;
};

function makeFake() {
  // A single OTC ticket in `quoted` status with a far-future expiry.
  const ticket = {
    id: "t1",
    userId: "u1",
    pair: "BTC/USDT",
    side: "buy" as const,
    amount: D("1"),
    quotedPrice: D("50000") as Prisma.Decimal | null,
    quoteExpiresAt: new Date(Date.now() + 60_000) as Date | null,
    status: "quoted",
    filledAt: null as Date | null,
    feeBps: null as number | null,
  };
  // Plenty of quote-asset balance to cover the buy notional.
  const balances: BalanceRow[] = [
    {
      userId: "u1",
      asset: "USDT",
      amount: D("1000000"),
      available: D("1000000"),
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    otcTicket: {
      findUnique: async () => ({ ...ticket }),
      update: async ({ data }: { data: Partial<typeof ticket> }) => {
        Object.assign(ticket, data);
        return { ...ticket };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string; quoteExpiresAt?: { gt: Date } };
        data: Partial<typeof ticket>;
      }) => {
        if (
          ticket.id === where.id &&
          ticket.status === where.status &&
          (!where.quoteExpiresAt ||
            (ticket.quoteExpiresAt &&
              ticket.quoteExpiresAt > where.quoteExpiresAt.gt))
        ) {
          Object.assign(ticket, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
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
          available?: { decrement?: Prisma.Decimal; increment?: Prisma.Decimal };
          amount?: { decrement?: Prisma.Decimal; increment?: Prisma.Decimal };
        };
      }) => {
        const row = balances.find(
          (b) =>
            b.userId === where.userId_asset.userId &&
            b.asset === where.userId_asset.asset,
        );
        if (!row) throw new Error("balance row missing");
        if (data.available?.decrement)
          row.available = row.available.sub(data.available.decrement);
        if (data.available?.increment)
          row.available = row.available.add(data.available.increment);
        if (data.amount?.decrement)
          row.amount = row.amount.sub(data.amount.decrement);
        if (data.amount?.increment)
          row.amount = row.amount.add(data.amount.increment);
        return row;
      },
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        update: {
          available?: { decrement?: Prisma.Decimal; increment?: Prisma.Decimal };
          amount?: { decrement?: Prisma.Decimal; increment?: Prisma.Decimal };
        };
        create: BalanceRow;
      }) => {
        const existing = balances.find(
          (b) =>
            b.userId === where.userId_asset.userId &&
            b.asset === where.userId_asset.asset,
        );
        if (existing) {
          if (update.available?.increment)
            existing.available = existing.available.add(update.available.increment);
          if (update.amount?.increment)
            existing.amount = existing.amount.add(update.amount.increment);
          return existing;
        }
        balances.push(create);
        return create;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db: db as AcceptDb, ticket, balances };
}

describe("acceptOtc — double-fill defence", () => {
  it("two concurrent accepts result in exactly one fill", async () => {
    const { db } = makeFake();
    const results = await Promise.allSettled([
      acceptOtc({ userId: "u1", ticketId: "t1", feeBps: 25 }, db),
      acceptOtc({ userId: "u1", ticketId: "t1", feeBps: 25 }, db),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("happy path produces the expected base/quote deltas", async () => {
    const { db } = makeFake();
    const r = await acceptOtc(
      { userId: "u1", ticketId: "t1", feeBps: 25 },
      db,
    );
    expect(r.filled).toBe(true);
    // notional = 1 * 50000 = 50000; fee = 50000 * 25 / 10000 = 125
    expect(r.quoteDelta).toBe("-50125");
    expect(r.baseDelta).toBe("1");
  });
});
