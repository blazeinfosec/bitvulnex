import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  derivableFlag,
  expectedSecretFor,
  patternCVulnIds,
} from "../derive";

function hash(vulnId: string, secret: string): string {
  return `{BLAZE_BITVULNEX_${createHash("sha256")
    .update(`${vulnId}:${secret}`)
    .digest("hex")
    .slice(0, 16)}}`;
}

describe("derivableFlag", () => {
  it("produces the spec'd format", () => {
    const f = derivableFlag("V-9", "changeme");
    expect(f).toMatch(/^\{BLAZE_BITVULNEX_[0-9a-f]{16}\}$/);
    expect(f).toBe(hash("V-9", "changeme"));
  });

  it("is deterministic across calls", () => {
    expect(derivableFlag("V-48", "devsecret-do-not-use-in-prod-bvbe-2026")).toBe(
      derivableFlag("V-48", "devsecret-do-not-use-in-prod-bvbe-2026"),
    );
  });

  it("differs across vulnIds even with same secret", () => {
    expect(derivableFlag("V-9", "x")).not.toBe(derivableFlag("V-48", "x"));
  });

  it("differs across secrets for the same vulnId", () => {
    expect(derivableFlag("V-9", "changeme")).not.toBe(
      derivableFlag("V-9", "wrong"),
    );
  });
});

describe("expectedSecretFor", () => {
  it("returns the canonical secret for V-9 (changeme)", () => {
    expect(expectedSecretFor("V-9")).toBe("changeme");
  });

  it("returns the canonical secret for V-48", () => {
    expect(expectedSecretFor("V-48")).toBe(
      "devsecret-do-not-use-in-prod-bvbe-2026",
    );
  });

  it("returns null for non-Pattern-C vulns", () => {
    expect(expectedSecretFor("V-4")).toBeNull();
    expect(expectedSecretFor("V-25")).toBeNull();
    expect(expectedSecretFor("not-a-vuln")).toBeNull();
  });
});

describe("patternCVulnIds", () => {
  it("lists the registered Pattern C vulns", () => {
    const ids = patternCVulnIds();
    expect(ids).toContain("V-9");
    expect(ids).toContain("V-48");
  });
});
