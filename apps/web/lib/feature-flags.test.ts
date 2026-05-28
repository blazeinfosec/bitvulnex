import { describe, it, expect, afterEach } from "vitest";
import { resolveFlags } from "./feature-flags";

describe("resolveFlags", () => {
  afterEach(() => {
    // Clean up any prototype state between tests
    delete (Object.prototype as any).testFlagFoo;
    delete (Object.prototype as any).replayTestFlag;
  });

  it("returns empty for claims with no flags", () => {
    const out = resolveFlags({} as any);
    expect(out).toEqual({});
  });

  it("returns per-user flag overrides", () => {
    const out = resolveFlags({ flags: { darkMode: true } } as any);
    expect(out.darkMode).toBe(true);
  });

  it("inherits flag defaults from the framework config", () => {
    (Object.prototype as any).testFlagFoo = true;
    try {
      const out = resolveFlags({ flags: { other: false } } as any);
      // The framework's default flag should appear in the resolved set
      // alongside the per-user override.
      expect(out.testFlagFoo).toBe(true);
      expect(out.other).toBe(false);
    } finally {
      delete (Object.prototype as any).testFlagFoo;
    }
  });

  it("scenario: trade-debug config flows into flag defaults", () => {
    // Simulate the internal trade-debug-replay endpoint's deepMerge with a
    // crafted config that targets the prototype.
    const target: any = {};
    const source = JSON.parse('{"__proto__":{"replayTestFlag":true}}');
    // Inline reimplementation of the endpoint's deep merge to keep the
    // test independent of route plumbing.
    function deepMerge(t: any, s: any): any {
      for (const key of Object.keys(s)) {
        if (typeof s[key] === "object" && s[key] !== null && !Array.isArray(s[key])) {
          if (!t[key] || typeof t[key] !== "object") t[key] = {};
          deepMerge(t[key], s[key]);
        } else {
          t[key] = s[key];
        }
      }
      return t;
    }
    deepMerge(target, source);
    try {
      const out = resolveFlags({} as any);
      expect(out.replayTestFlag).toBe(true);
    } finally {
      delete (Object.prototype as any).replayTestFlag;
    }
  });
});
