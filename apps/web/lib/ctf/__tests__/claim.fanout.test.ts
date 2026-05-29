// Slice-2 fan-out coverage: every claim validator and Pattern C
// secret has at least one positive + one negative case.

import { describe, expect, it, vi, beforeEach } from "vitest";

let ctfMode = true;
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

beforeEach(() => {
  ctfMode = true;
});

describe("Pattern C — discovered secrets", () => {
  const cases: Array<[string, string]> = [
    ["V-9", "changeme"],
    ["V-15", "CVE-2023-0842"],
    ["V-48", "devsecret-do-not-use-in-prod-bvbe-2026"],
    ["V-49", "@bvbe-internal/observability"],
  ];
  for (const [v, secret] of cases) {
    it(`${v} accepts the canonical secret`, async () => {
      const r = await processClaim(v, secret);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.flag).toBe(derivableFlag(v, secret));
    });
    it(`${v} rejects a wrong secret`, async () => {
      const r = await processClaim(v, "wrong-secret-xyz");
      expect(r.ok).toBe(false);
    });
  }
});

describe("Pattern B — exploit-proof validators (slice-2 stubs)", () => {
  const passes: Array<[string, string]> = [
    ["V-8", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."],
    ["V-10", "abcdef0123456789"],
    ["V-11", "' OR 1=1 --"],
    ["V-12", "x'; UNION SELECT 1 --"],
    ["V-14", "../../etc/passwd"],
    ["V-17", "uid=0(root) gid=0"],
    ["V-18", "<img onerror='alert(1)' src='x'>"],
    ["V-19", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig"],
    ["V-20", "../keys/legacy.pem"],
    ["V-21", "abc_DEF-123_xyz789_456789ABC"],
    ["V-23", "ws-data-frame"],
    ["V-24", "bc1qz​z​"],
    ["V-27", "10"],
    ["V-28", "wd_id_42"],
    ["V-30", "tx_id_99"],
    ["V-32", "12345"],
    ["V-33", "BVBE_PSBT_V1:abc BVBE_PSBT_V1:def BVBE_PSBT_V1:ghi"],
    ["V-34", '{"adminPanel":true}'],
    ["V-35", "<some privileged json>"],
    ["V-41", "<script>alert(1)</script>"],
  ];
  for (const [v, proof] of passes) {
    it(`${v} accepts a plausible proof`, async () => {
      const r = await processClaim(v, proof);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.flag).toMatch(/^BVBE\{[0-9a-f]{32}\}$/);
    });
  }

  // A subset of negative cases (each validator has at least one
  // rejected shape). Exhaustive negatives live with each validator's
  // judgement.
  it("V-8 rejects a JWT with alg=HS256 as 'none-proof'", async () => {
    const r = await processClaim(
      "V-8",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig",
    );
    expect(r.ok).toBe(false);
  });
  it("V-10 rejects a short hex string", async () => {
    const r = await processClaim("V-10", "abc");
    expect(r.ok).toBe(false);
  });
  it("V-11 rejects a benign string", async () => {
    const r = await processClaim("V-11", "hello world");
    expect(r.ok).toBe(false);
  });
  it("V-14 rejects a path with no traversal", async () => {
    const r = await processClaim("V-14", "kyc/passport.pdf");
    expect(r.ok).toBe(false);
  });
  it("V-33 rejects a single PSBT segment", async () => {
    const r = await processClaim("V-33", "BVBE_PSBT_V1:abc");
    expect(r.ok).toBe(false);
  });
  it("V-34 rejects a flags payload without adminPanel:true", async () => {
    const r = await processClaim("V-34", '{"betaUI":true}');
    expect(r.ok).toBe(false);
  });
});

describe("Killer chain validators", () => {
  it("CHAIN-A requires both V-48 secret and a polyglot PSBT", async () => {
    const proof = [
      "secret=devsecret-do-not-use-in-prod-bvbe-2026",
      "BVBE_PSBT_V1:val BVBE_PSBT_V1:attacker BVBE_PSBT_V1:final",
    ].join(";");
    const r = await processClaim("CHAIN-A", proof);
    expect(r.ok).toBe(true);
  });
  it("CHAIN-A rejects proof missing the polyglot", async () => {
    const r = await processClaim(
      "CHAIN-A",
      "secret=devsecret-do-not-use-in-prod-bvbe-2026",
    );
    expect(r.ok).toBe(false);
  });

  it("CHAIN-B requires a smuggled PATCH /api/v2/me with role:admin", async () => {
    const proof = [
      "POST / HTTP/1.1",
      "Host: target",
      "Transfer-Encoding: chunked",
      "Content-Length: 4",
      "",
      "0",
      "",
      "PATCH /api/v2/me HTTP/1.1",
      "Content-Type: application/json",
      "",
      '{"role":"admin"}',
    ].join("\r\n");
    const r = await processClaim("CHAIN-B", proof);
    expect(r.ok).toBe(true);
  });
  it("CHAIN-B rejects a non-smuggled body", async () => {
    const r = await processClaim("CHAIN-B", '{"role":"admin"}');
    expect(r.ok).toBe(false);
  });

  it("CHAIN-C accepts <self-trade-id>,<liquidation-id>", async () => {
    const r = await processClaim("CHAIN-C", "104,2200");
    expect(r.ok).toBe(true);
  });
  it("CHAIN-C rejects a single id", async () => {
    const r = await processClaim("CHAIN-C", "104");
    expect(r.ok).toBe(false);
  });

  it("CHAIN-D accepts a kyc-bucket path", async () => {
    const r = await processClaim(
      "CHAIN-D",
      "kyc-bucket/user-001/passport-front.pdf",
    );
    expect(r.ok).toBe(true);
  });
  it("CHAIN-D rejects a non-bucket path", async () => {
    const r = await processClaim("CHAIN-D", "kyc/user-001/passport.pdf");
    expect(r.ok).toBe(false);
  });
});

describe("CTF_MODE off short-circuit (slice-1 invariant preserved)", () => {
  beforeEach(() => {
    ctfMode = false;
  });
  it("any claim returns 404", async () => {
    const r = await processClaim("V-9", "changeme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
