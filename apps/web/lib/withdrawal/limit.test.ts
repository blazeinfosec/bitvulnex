import { describe, it, expect, beforeEach } from "vitest";
import {
  LimitExceededError,
  amountToCents,
  checkAndDebitLimit,
  currentDayUtc,
} from "./limit";
import { Prisma } from "@bvbe/db";

type Row = {
  id: string;
  userId: string;
  utcDate: Date;
  asset: string;
  totalCents: bigint;
};

function makeFakeDb() {
  const rows: Row[] = [];
  let seq = 0;
  const key = (r: { userId: string; utcDate: Date; asset: string }) =>
    `${r.userId}|${r.utcDate.toISOString().slice(0, 10)}|${r.asset}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
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
        const k = key(where.userId_utcDate_asset);
        return rows.find((r) => key(r) === k) ?? null;
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
        create: Omit<Row, "id">;
        update: { totalCents: { increment: bigint } };
      }) => {
        const k = key(where.userId_utcDate_asset);
        const existing = rows.find((r) => key(r) === k);
        if (existing) {
          existing.totalCents = existing.totalCents + update.totalCents.increment;
          return existing;
        }
        const row: Row = { id: `r${++seq}`, ...create };
        rows.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { totalCents: bigint };
      }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        row.totalCents = data.totalCents;
        return row;
      },
    },
  };
  return { db, rows };
}

describe("withdrawal limit", () => {
  let fake: ReturnType<typeof makeFakeDb>;
  beforeEach(() => {
    fake = makeFakeDb();
  });

  it("currentDayUtc truncates to start of UTC day", () => {
    const d = new Date("2026-06-20T15:30:45.123Z");
    const day = currentDayUtc(d);
    expect(day.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("amountToCents converts BTC at the reference price", () => {
    expect(amountToCents("BTC", new Prisma.Decimal("0.5"))).toBe(30_000_00);
    expect(amountToCents("USDT", new Prisma.Decimal("100"))).toBe(100_00);
  });

  it("admits a withdrawal under the limit", async () => {
    await expect(
      checkAndDebitLimit(
        { userId: "u1", tier: 1, asset: "USDT", amountCents: 500_00 },
        fake.db,
      ),
    ).resolves.toBeUndefined();
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]?.totalCents).toBe(500_00n);
  });

  it("rejects a withdrawal that pushes past the limit", async () => {
    // Tier-1 daily limit = 1_000_00 cents ($1000). Pre-populate to
    // 800_00, then try to debit 300_00 → 1_100_00 > 1_000_00.
    await checkAndDebitLimit(
      { userId: "u1", tier: 1, asset: "USDT", amountCents: 800_00 },
      fake.db,
    );
    await expect(
      checkAndDebitLimit(
        { userId: "u1", tier: 1, asset: "USDT", amountCents: 300_00 },
        fake.db,
      ),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });
});
