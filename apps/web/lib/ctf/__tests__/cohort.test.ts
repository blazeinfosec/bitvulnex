// Phase 11 slice 3 — hint policy resolution matrix.

import { describe, expect, it, vi, beforeEach } from "vitest";

let ctfMode = true;
vi.mock("@/lib/ctf", () => ({
  ctfModeEnabled: () => ctfMode,
  flagFor: (v: string) => `{BLAZE_BITVULNEX_${v}-fake}`,
}));

const cohortMem = new Map<
  string,
  { hintsDefault: boolean; archivedAt: Date | null; verboseUnlockSeconds: number }
>();
const userMem = new Map<
  string,
  { cohortId: string | null; hintsOverride: "follow" | "enable" | "disable" }
>();

vi.mock("@bvbe/db", () => ({
  prisma: {
    cohort: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = cohortMem.get(where.id);
        return c
          ? {
              id: where.id,
              name: where.id,
              saltFingerprint: "fp",
              hintsDefault: c.hintsDefault,
              verboseUnlockSeconds: c.verboseUnlockSeconds,
              archivedAt: c.archivedAt,
            }
          : null;
      }),
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        const id = `cohort-${data.name}`;
        cohortMem.set(id, {
          hintsDefault: false,
          archivedAt: null,
          verboseUnlockSeconds: 900,
        });
        return { id };
      }),
    },
    user: {
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string };
          select?: Record<string, boolean>;
        }) => {
          const u = userMem.get(where.id);
          if (!u) return null;
          // Honor selects so the helper's call shape matches reality.
          if (select?.cohortId && !select?.hintsOverride)
            return { cohortId: u.cohortId };
          return u;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { cohortId: string };
        }) => {
          const u = userMem.get(where.id) ?? {
            cohortId: null,
            hintsOverride: "follow" as const,
          };
          u.cohortId = data.cohortId;
          userMem.set(where.id, u);
          return u;
        },
      ),
    },
  },
}));

import { hintsAllowedFor } from "../cohort";

beforeEach(() => {
  ctfMode = true;
  cohortMem.clear();
  userMem.clear();
});

describe("hintsAllowedFor — resolution matrix", () => {
  it("forbids when CTF_MODE is off", async () => {
    ctfMode = false;
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "follow" });
    cohortMem.set("cohort-A", {
      hintsDefault: true,
      archivedAt: null,
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("ctf-mode-off");
  });

  it("forbids when user has no cohort", async () => {
    userMem.set("u1", { cohortId: null, hintsOverride: "follow" });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("no-cohort");
  });

  it("forbids when cohort is archived", async () => {
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "follow" });
    cohortMem.set("cohort-A", {
      hintsDefault: true,
      archivedAt: new Date(),
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cohort-archived");
  });

  it("forbids when cohort default OFF and user follows", async () => {
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "follow" });
    cohortMem.set("cohort-A", {
      hintsDefault: false,
      archivedAt: null,
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cohort-default-disabled");
  });

  it("allows when cohort default OFF and user enables", async () => {
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "enable" });
    cohortMem.set("cohort-A", {
      hintsDefault: false,
      archivedAt: null,
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(true);
    expect(r.cohortId).toBe("cohort-A");
  });

  it("allows when cohort default ON and user follows", async () => {
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "follow" });
    cohortMem.set("cohort-A", {
      hintsDefault: true,
      archivedAt: null,
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(true);
  });

  it("forbids when cohort default ON but user disables (opt-out)", async () => {
    userMem.set("u1", { cohortId: "cohort-A", hintsOverride: "disable" });
    cohortMem.set("cohort-A", {
      hintsDefault: true,
      archivedAt: null,
      verboseUnlockSeconds: 60,
    });
    const r = await hintsAllowedFor("u1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("user-disabled");
  });
});
