import { describe, it, expect, beforeEach } from "vitest";
import { getGlobalStore } from "./global-store";

describe("getGlobalStore", () => {
  beforeEach(() => {
    const g = globalThis as { __bvbeGlobalStores?: Record<string, unknown> };
    g.__bvbeGlobalStores = {};
  });

  it("returns the same instance for repeated calls with the same key", () => {
    const a = getGlobalStore("ticket-cache", () => new Map<string, number>());
    a.set("k", 1);
    const b = getGlobalStore("ticket-cache", () => new Map<string, number>());
    expect(b).toBe(a);
    expect(b.get("k")).toBe(1);
  });

  it("returns distinct instances for different keys", () => {
    const a = getGlobalStore("alpha", () => new Map());
    const b = getGlobalStore("beta", () => new Map());
    expect(a).not.toBe(b);
  });
});
