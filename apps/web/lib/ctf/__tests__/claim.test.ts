import { describe, expect, it, vi, beforeEach } from "vitest";

let ctfMode = false;
vi.mock("@/lib/ctf", async () => {
  const { createHash } = await import("node:crypto");
  return {
    ctfModeEnabled: () => ctfMode,
    flagFor: (vulnId: string) =>
      `BVBE{${createHash("sha256")
        .update(`${vulnId}:test-salt`)
        .digest("hex")
        .slice(0, 32)}}`,
  };
});

import { processClaim } from "../claim";
import { derivableFlag } from "../derive";

describe("processClaim — CTF_MODE off", () => {
  beforeEach(() => {
    ctfMode = false;
  });

  it("returns 404 for any input", async () => {
    const r = await processClaim("V-1", "anything");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("processClaim — Pattern B (V-1, V-13) under CTF_MODE", () => {
  beforeEach(() => {
    ctfMode = true;
  });

  it("V-1 accepts any non-empty proof", async () => {
    const r = await processClaim("V-1", "exfil-tag-xyz");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.flag).toMatch(/^BVBE\{[0-9a-f]{32}\}$/);
  });

  it("V-1 rejects whitespace-only proof", async () => {
    const r = await processClaim("V-1", "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("V-13 accepts an off-origin https URL", async () => {
    const r = await processClaim("V-13", "https://attacker.example/phish");
    expect(r.ok).toBe(true);
  });

  it("V-13 accepts an off-origin http URL", async () => {
    const r = await processClaim("V-13", "http://attacker.example/phish");
    expect(r.ok).toBe(true);
  });

  it("V-13 rejects same-origin localhost", async () => {
    const r = await processClaim("V-13", "http://localhost/anything");
    expect(r.ok).toBe(false);
  });

  it("V-13 rejects 127.0.0.1", async () => {
    const r = await processClaim("V-13", "http://127.0.0.1/x");
    expect(r.ok).toBe(false);
  });

  it("V-13 rejects exchange.local", async () => {
    const r = await processClaim("V-13", "http://exchange.local/x");
    expect(r.ok).toBe(false);
  });

  it("V-13 rejects garbage", async () => {
    const r = await processClaim("V-13", "not-a-url");
    expect(r.ok).toBe(false);
  });

  it("V-13 rejects non-http schemes", async () => {
    const r = await processClaim("V-13", "javascript:alert(1)");
    expect(r.ok).toBe(false);
  });
});

describe("processClaim — Pattern C (V-9, V-48) under CTF_MODE", () => {
  beforeEach(() => {
    ctfMode = true;
  });

  it("V-9 returns the deterministic flag for the right secret", async () => {
    const r = await processClaim("V-9", "changeme");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.flag).toBe(derivableFlag("V-9", "changeme"));
  });

  it("V-9 rejects a wrong secret", async () => {
    const r = await processClaim("V-9", "wrong-secret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("V-48 returns the deterministic flag for the right secret", async () => {
    const r = await processClaim(
      "V-48",
      "devsecret-do-not-use-in-prod-bvbe-2026",
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.flag).toBe(
        derivableFlag("V-48", "devsecret-do-not-use-in-prod-bvbe-2026"),
      );
  });
});

describe("processClaim — unknown vulnId", () => {
  beforeEach(() => {
    ctfMode = true;
  });

  it("rejects an unrecognized vulnId", async () => {
    const r = await processClaim("V-999", "anything");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
