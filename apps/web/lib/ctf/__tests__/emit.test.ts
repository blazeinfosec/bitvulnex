import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the env module so we can flip CTF_MODE per test.
let ctfMode = false;
vi.mock("@/lib/ctf", async () => {
  const { createHash } = await import("node:crypto");
  return {
    ctfModeEnabled: () => ctfMode,
    flagFor: (vulnId: string) =>
      `{BLAZE_BITVULNEX_${createHash("sha256")
        .update(`${vulnId}:test-salt`)
        .digest("hex")
        .slice(0, 16)}}`,
  };
});

import { maybeEmitFlag } from "../emit";

describe("maybeEmitFlag", () => {
  beforeEach(() => {
    ctfMode = false;
  });
  afterEach(() => {
    ctfMode = false;
  });

  it("passes through unchanged when CTF_MODE is off", () => {
    const out = maybeEmitFlag({ ok: true, x: 1 }, "V-4");
    expect(out).toEqual({ ok: true, x: 1 });
    expect((out as Record<string, unknown>)._flag).toBeUndefined();
  });

  it("adds a _flag field when CTF_MODE is on", () => {
    ctfMode = true;
    const out = maybeEmitFlag({ ok: true }, "V-4");
    expect(out.ok).toBe(true);
    expect((out as { _flag?: string })._flag).toMatch(
      /^\{BLAZE_BITVULNEX_[0-9a-f]{16}\}$/,
    );
  });

  it("produces stable flag for the same vulnId", () => {
    ctfMode = true;
    const a = maybeEmitFlag({}, "V-4");
    const b = maybeEmitFlag({}, "V-4");
    expect((a as { _flag: string })._flag).toBe((b as { _flag: string })._flag);
  });

  it("produces different flag for different vulnIds", () => {
    ctfMode = true;
    const v4 = maybeEmitFlag({}, "V-4");
    const v25 = maybeEmitFlag({}, "V-25");
    expect((v4 as { _flag: string })._flag).not.toBe(
      (v25 as { _flag: string })._flag,
    );
  });

  it("does not mutate the input payload", () => {
    ctfMode = true;
    const input = { ok: true };
    const out = maybeEmitFlag(input, "V-4");
    expect(out).not.toBe(input);
    expect((input as Record<string, unknown>)._flag).toBeUndefined();
  });
});
