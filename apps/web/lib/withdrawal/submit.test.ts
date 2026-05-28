import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  InsufficientBalanceError,
  WithdrawalValidationError,
  submitWithdrawal,
} from "./submit";

type Balance = {
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  available: Prisma.Decimal;
  locked: Prisma.Decimal;
};

type Withdrawal = {
  id: string;
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  destAddress: string;
  status: string;
};

function D(v: string | number) {
  return new Prisma.Decimal(v);
}

function makeFakeDb(seed: Balance[]) {
  const balances = new Map<string, Balance>();
  for (const b of seed) balances.set(`${b.userId}:${b.asset}`, b);
  const ledger: Array<{
    userId: string;
    utcDate: Date;
    asset: string;
    totalCents: bigint;
  }> = [];
  const withdrawals: Withdrawal[] = [];
  let seq = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    balance: {
      findUnique: async ({
        where,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
      }) =>
        balances.get(
          `${where.userId_asset.userId}:${where.userId_asset.asset}`,
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
        const k = `${where.userId_asset.userId}:${where.userId_asset.asset}`;
        const row = balances.get(k);
        if (!row) throw new Error("not found");
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
    },
    withdrawalLimitLedger: {
      findUnique: async ({
        where,
      }: {
        where: {
          userId_utcDate_asset: {
            userId: string;
            utcDate: Date;
            asset: string;
          };
        };
      }) => {
        const k = where.userId_utcDate_asset;
        return (
          ledger.find(
            (r) =>
              r.userId === k.userId &&
              r.asset === k.asset &&
              r.utcDate.toISOString().slice(0, 10) ===
                k.utcDate.toISOString().slice(0, 10),
          ) ?? null
        );
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          userId_utcDate_asset: {
            userId: string;
            utcDate: Date;
            asset: string;
          };
        };
        create: {
          userId: string;
          utcDate: Date;
          asset: string;
          totalCents: bigint;
        };
        update: { totalCents: { increment: bigint } };
      }) => {
        const k = where.userId_utcDate_asset;
        const existing = ledger.find(
          (r) =>
            r.userId === k.userId &&
            r.asset === k.asset &&
            r.utcDate.toISOString().slice(0, 10) ===
              k.utcDate.toISOString().slice(0, 10),
        );
        if (existing) {
          existing.totalCents += update.totalCents.increment;
          return existing;
        }
        const row = { ...create };
        ledger.push(row);
        return row;
      },
    },
    withdrawal: {
      create: async ({ data }: { data: Omit<Withdrawal, "id"> }) => {
        const row: Withdrawal = { id: `w${++seq}`, ...data };
        withdrawals.push(row);
        return row;
      },
    },
  };
  return { db, balances, withdrawals };
}

describe("submitWithdrawal", () => {
  let fake: ReturnType<typeof makeFakeDb>;
  beforeEach(() => {
    fake = makeFakeDb([
      {
        userId: "u1",
        asset: "BTC",
        amount: D("1.0"),
        available: D("1.0"),
        locked: D(0),
      },
    ]);
  });

  it("creates a pending withdrawal and debits the balance", async () => {
    const out = await submitWithdrawal(
      {
        userId: "u1",
        tier: 3,
        asset: "BTC",
        amount: "0.10000000",
        destAddress: "bcrt1q9q5q5q5q5q5q5q5q5q5q5q5q5q5q5q5q5",
      },
      fake.db,
    );
    expect(out.withdrawalId).toBeTruthy();
    expect(fake.withdrawals).toHaveLength(1);
    expect(fake.withdrawals[0]?.status).toBe("pending");
    const bal = fake.balances.get("u1:BTC")!;
    // 1.0 - 0.1 - 0.0001 fee = 0.8999
    expect(bal.available.toFixed(8)).toBe("0.89990000");
  });

  it("rejects an invalid destination address", async () => {
    await expect(
      submitWithdrawal(
        {
          userId: "u1",
          tier: 3,
          asset: "BTC",
          amount: "0.1",
          destAddress: "definitely_not_a_btc_address",
        },
        fake.db,
      ),
    ).rejects.toBeInstanceOf(WithdrawalValidationError);
  });

  it("rejects when the balance is insufficient", async () => {
    await expect(
      submitWithdrawal(
        {
          userId: "u1",
          tier: 3,
          asset: "BTC",
          amount: "5.0",
          destAddress: "bcrt1q9q5q5q5q5q5q5q5q5q5q5q5q5q5q5q5q5",
        },
        fake.db,
      ),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
