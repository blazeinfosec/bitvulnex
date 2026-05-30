// Phase 11 slice 3 — hint depth validator + loader.

import { describe, expect, it } from "vitest";
import {
  loadAllHints,
  loadHint,
  validateHint,
  HintValidationError,
  clearHintCache,
} from "../hints";

describe("loadAllHints — markdown scaffold", () => {
  it("parses every file under docs/hints/", () => {
    clearHintCache();
    const all = loadAllHints();
    expect(all.size).toBeGreaterThan(0);
  });

  it("loads the V-NNN exemplars", () => {
    clearHintCache();
    const all = loadAllHints();
    for (const id of [
      "V-1",
      "V-4",
      "V-9",
      "V-13",
      "V-14",
      "V-22",
      "V-25",
      "V-40",
      "V-46",
      "V-51",
    ]) {
      expect(all.has(id), `expected ${id}.md to load`).toBe(true);
    }
  });

  it("explodes chain files into per-step records", () => {
    clearHintCache();
    const all = loadAllHints();
    for (const chain of ["CHAIN-A", "CHAIN-B", "CHAIN-C", "CHAIN-D"]) {
      for (const step of [1, 2, 3]) {
        const key = `${chain}-STEP-${step}`;
        expect(all.has(key), `expected ${key}`).toBe(true);
      }
    }
  });

  it("loadHint returns basic and verbose prose", () => {
    clearHintCache();
    const basic = loadHint("V-4", 1);
    const verbose = loadHint("V-4", 2);
    expect(basic).not.toBeNull();
    expect(verbose).not.toBeNull();
    expect(basic!.text).not.toEqual(verbose!.text);
    expect(basic!.text.length).toBeLessThanOrEqual(200);
    expect(verbose!.text.length).toBeLessThanOrEqual(600);
  });

  it("loadHint returns null for unknown target", () => {
    clearHintCache();
    expect(loadHint("V-999", 1)).toBeNull();
  });
});

describe("validateHint — depth ceiling enforcement", () => {
  const valid = {
    targetKey: "V-X",
    category: "Test",
    tier1Basic: "A short generic hint about a vuln class.",
    tier2Verbose: "A medium-length lens-level hint that names what to scrutinize but never says where the code lives or which payload to use.",
  };

  it("accepts a well-formed record", () => {
    expect(() => validateHint(valid)).not.toThrow();
  });

  it("rejects empty basic", () => {
    expect(() =>
      validateHint({ ...valid, tier1Basic: "" }),
    ).toThrow(HintValidationError);
  });

  it("rejects empty verbose", () => {
    expect(() =>
      validateHint({ ...valid, tier2Verbose: "" }),
    ).toThrow(HintValidationError);
  });

  it("rejects basic > 200 chars", () => {
    expect(() =>
      validateHint({ ...valid, tier1Basic: "x".repeat(201) }),
    ).toThrow(HintValidationError);
  });

  it("rejects verbose > 600 chars", () => {
    expect(() =>
      validateHint({ ...valid, tier2Verbose: "y".repeat(601) }),
    ).toThrow(HintValidationError);
  });

  it("rejects basic that names a file path", () => {
    expect(() =>
      validateHint({
        ...valid,
        tier1Basic: "Check apps/web/app/api/v2/me/route.ts",
      }),
    ).toThrow(/category-only/);
  });

  it("rejects basic that names a CVE", () => {
    expect(() =>
      validateHint({ ...valid, tier1Basic: "Look up CVE-2023-0842." }),
    ).toThrow(/category-only/);
  });

  it("rejects verbose that names a file path", () => {
    expect(() =>
      validateHint({
        ...valid,
        tier2Verbose: "The plant is in packages/shared/src/jwt-v1.ts",
      }),
    ).toThrow(/lens \+ category/);
  });

  it("rejects verbose that includes a curl payload", () => {
    expect(() =>
      validateHint({
        ...valid,
        tier2Verbose: "Run curl -X POST /api/v2/me with role:admin.",
      }),
    ).toThrow(/lens \+ category/);
  });

  it("rejects basic that mentions line numbers", () => {
    expect(() =>
      validateHint({ ...valid, tier1Basic: "Look at line 42." }),
    ).toThrow(/category-only/);
  });
});

describe("authored exemplars pass the validator", () => {
  it("every authored hint passes validation on load", () => {
    clearHintCache();
    // loadAllHints already validates as it parses; if any file fails
    // the loader throws and the suite blows up.
    expect(() => loadAllHints()).not.toThrow();
  });
});
