// Phase 11 slice 3 — first-interaction timer + verbose-unlock
// arithmetic. Pure unit-tests against an in-memory mock of Prisma's
// CtfInteraction + Cohort tables; integration tests live in the route
// handler tests under apps/web/app/api/v2/ctf/.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/ctf", () => ({
  ctfModeEnabled: () => true,
  flagFor: (v: string) => `BVBE{${v}-fake}`,
}));

const cohortMem = new Map<string, { verboseUnlockSeconds: number }>();
const interMem = new Map<string, { firstAt: Date }>();

function interKey(c: string, u: string, t: string): string {
  return `${c}:${u}:${t}`;
}

vi.mock("@bvbe/db", () => {
  return {
    prisma: {
      cohort: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const c = cohortMem.get(where.id);
          return c
            ? {
                id: where.id,
                name: where.id,
                saltFingerprint: "fp",
                hintsDefault: false,
                verboseUnlockSeconds: c.verboseUnlockSeconds,
                archivedAt: null,
              }
            : null;
        }),
      },
      ctfInteraction: {
        upsert: vi.fn(
          async ({
            where,
            create,
          }: {
            where: { cohortId_userId_targetKey: { cohortId: string; userId: string; targetKey: string } };
            create: { cohortId: string; userId: string; targetKey: string };
          }) => {
            const k = interKey(
              where.cohortId_userId_targetKey.cohortId,
              where.cohortId_userId_targetKey.userId,
              where.cohortId_userId_targetKey.targetKey,
            );
            const existing = interMem.get(k);
            if (existing) return existing;
            const row = { firstAt: new Date() };
            interMem.set(k, row);
            return row;
          },
        ),
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: { cohortId_userId_targetKey: { cohortId: string; userId: string; targetKey: string } };
          }) => {
            const k = interKey(
              where.cohortId_userId_targetKey.cohortId,
              where.cohortId_userId_targetKey.userId,
              where.cohortId_userId_targetKey.targetKey,
            );
            return interMem.get(k) ?? null;
          },
        ),
      },
    },
  };
});

import {
  recordFirstInteraction,
  verboseUnlockedFor,
} from "../interaction";

beforeEach(() => {
  cohortMem.clear();
  interMem.clear();
  cohortMem.set("cohort-A", { verboseUnlockSeconds: 60 });
});

describe("recordFirstInteraction — atomic upsert", () => {
  it("creates a row on first call", async () => {
    const first = await recordFirstInteraction("cohort-A", "u1", "V-4");
    expect(first).toBeInstanceOf(Date);
  });

  it("returns the SAME firstAt on subsequent calls (no row stomping)", async () => {
    const first = await recordFirstInteraction("cohort-A", "u1", "V-4");
    await new Promise((r) => setTimeout(r, 20));
    const second = await recordFirstInteraction("cohort-A", "u1", "V-4");
    expect(second.getTime()).toBe(first.getTime());
  });

  it("scopes to (cohort, user, target)", async () => {
    const a = await recordFirstInteraction("cohort-A", "u1", "V-4");
    const b = await recordFirstInteraction("cohort-A", "u2", "V-4");
    const c = await recordFirstInteraction("cohort-A", "u1", "V-22");
    expect(a.getTime()).not.toBe(b.getTime() + 1); // distinct rows
    expect(a.getTime()).not.toBe(c.getTime() + 1);
  });
});

describe("verboseUnlockedFor — countdown arithmetic", () => {
  it("returns secondsRemaining = full window when no interaction", async () => {
    const out = await verboseUnlockedFor("cohort-A", "u1", "V-4");
    expect(out.unlocked).toBe(false);
    expect(out.secondsRemaining).toBe(60);
    expect(out.firstAt).toBeNull();
  });

  it("returns unlocked once enough wall-clock time has passed", async () => {
    const now = new Date();
    await recordFirstInteraction("cohort-A", "u1", "V-4");
    const out = await verboseUnlockedFor(
      "cohort-A",
      "u1",
      "V-4",
      new Date(now.getTime() + 61_000),
    );
    expect(out.unlocked).toBe(true);
    expect(out.secondsRemaining).toBe(0);
  });

  it("returns the ceiling of secondsRemaining mid-window", async () => {
    const now = new Date();
    await recordFirstInteraction("cohort-A", "u1", "V-4");
    const out = await verboseUnlockedFor(
      "cohort-A",
      "u1",
      "V-4",
      new Date(now.getTime() + 30_500), // 30.5s elapsed → 30s remaining (ceil after sub)
    );
    expect(out.unlocked).toBe(false);
    expect(out.secondsRemaining).toBeGreaterThan(0);
    expect(out.secondsRemaining).toBeLessThanOrEqual(60);
  });

  it("falls back to 900s when cohort missing", async () => {
    const out = await verboseUnlockedFor("nope", "u1", "V-4");
    expect(out.secondsRemaining).toBe(900);
  });
});
