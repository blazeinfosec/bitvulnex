import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import { claimRewards, type ClaimDb } from "./claim";

const D = (v: string | number) => new Prisma.Decimal(v);

function makeFake(seed: {
  positions: Array<{
    id: string;
    userId: string;
    asset: string;
    principal: Prisma.Decimal;
    status: "active" | "unstaking" | "ended";
  }>;
  programs: Array<{ asset: string; rewardAsset: string; apyBps: number }>;
  claims: Array<{
    id: string;
    positionId: string;
    amount: Prisma.Decimal;
    claimedAt: Date | null;
  }>;
}) {
  const positions = seed.positions.map((p) => ({ ...p }));
  const programs = seed.programs.map((p) => ({ ...p }));
  const claims = seed.claims.map((c) => ({ ...c }));
  const balances: Array<{
    userId: string;
    asset: string;
    available: Prisma.Decimal;
    amount: Prisma.Decimal;
  }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    stakingPosition: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        positions.find(
          (p) =>
            p.id === where.id &&
            p.userId === where.userId &&
            (typeof where.status === "object" && where.status !== null
              ? (where.status as { in: string[] }).in.includes(p.status)
              : p.status === where.status),
        ) ?? null,
    },
    stakingProgram: {
      findUnique: async ({ where }: { where: { asset: string } }) =>
        programs.find((p) => p.asset === where.asset) ?? null,
    },
    stakingClaim: {
      findMany: async ({
        where,
      }: {
        where: { positionId: string; claimedAt: null };
      }) =>
        claims.filter(
          (c) => c.positionId === where.positionId && c.claimedAt === null,
        ),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { claimedAt: Date };
      }) => {
        const c = claims.find((cc) => cc.id === where.id);
        if (c) c.claimedAt = data.claimedAt;
        return c;
      },
    },
    balance: {
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        update: {
          available: { increment: Prisma.Decimal };
          amount: { increment: Prisma.Decimal };
        };
        create: {
          userId: string;
          asset: string;
          available: Prisma.Decimal;
          amount: Prisma.Decimal;
        };
      }) => {
        const existing = balances.find(
          (b) =>
            b.userId === where.userId_asset.userId &&
            b.asset === where.userId_asset.asset,
        );
        if (existing) {
          existing.available = existing.available.add(update.available.increment);
          existing.amount = existing.amount.add(update.amount.increment);
          return existing;
        }
        balances.push({
          userId: create.userId,
          asset: create.asset,
          available: create.available,
          amount: create.amount,
        });
        return balances[balances.length - 1]!;
      },
    },
  };

  return { db: db as ClaimDb, claims, balances };
}

describe("claimRewards (happy path)", () => {
  it("credits a single unclaimed window and marks the row claimed", async () => {
    const { db, claims, balances } = makeFake({
      positions: [
        {
          id: "sp1",
          userId: "u1",
          asset: "ETH",
          principal: D(10),
          status: "active",
        },
      ],
      programs: [{ asset: "ETH", rewardAsset: "ETH", apyBps: 400 }],
      claims: [
        {
          id: "sc1",
          positionId: "sp1",
          amount: D("0.5"),
          claimedAt: null,
        },
      ],
    });
    const res = await claimRewards({ userId: "u1", positionId: "sp1" }, db);
    expect(res.credited).toBe("0.5");
    expect(res.rows).toBe(1);
    expect(claims[0]?.claimedAt).not.toBeNull();
    expect(balances[0]?.available.toString()).toBe("0.5");
  });

  it("still credits rewards accrued before the position ended", async () => {
    const { db, claims, balances } = makeFake({
      positions: [
        {
          id: "sp1",
          userId: "u1",
          asset: "ETH",
          principal: D(10),
          status: "ended",
        },
      ],
      programs: [{ asset: "ETH", rewardAsset: "ETH", apyBps: 400 }],
      claims: [
        { id: "sc1", positionId: "sp1", amount: D("0.25"), claimedAt: null },
      ],
    });
    const res = await claimRewards({ userId: "u1", positionId: "sp1" }, db);
    expect(res.credited).toBe("0.25");
    expect(claims[0]?.claimedAt).not.toBeNull();
    expect(balances[0]?.amount.toString()).toBe("0.25");
  });

  it("rejects a position owned by another user", async () => {
    const { db } = makeFake({
      positions: [
        {
          id: "sp1",
          userId: "u2",
          asset: "ETH",
          principal: D(10),
          status: "ended",
        },
      ],
      programs: [{ asset: "ETH", rewardAsset: "ETH", apyBps: 400 }],
      claims: [],
    });
    await expect(
      claimRewards({ userId: "u1", positionId: "sp1" }, db),
    ).rejects.toThrow(/position not found/);
  });

  it("is a no-op when there are no unclaimed rows", async () => {
    const { db } = makeFake({
      positions: [
        {
          id: "sp1",
          userId: "u1",
          asset: "ETH",
          principal: D(10),
          status: "active",
        },
      ],
      programs: [{ asset: "ETH", rewardAsset: "ETH", apyBps: 400 }],
      claims: [],
    });
    const res = await claimRewards({ userId: "u1", positionId: "sp1" }, db);
    expect(res.rows).toBe(0);
    expect(res.credited).toBe("0");
  });
});
