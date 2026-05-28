import { describe, it, expect } from "vitest";
import {
  issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  hashRefreshToken,
} from "./jwt";

const SECRET = "x".repeat(48);

describe("v2 jwt", () => {
  it("round-trips access tokens", async () => {
    const token = await issueAccessToken(
      { sub: "u1", email: "u1@example.test", role: "user", kycTier: 0 },
      SECRET,
    );
    const claims = await verifyAccessToken(token, SECRET);
    expect(claims.sub).toBe("u1");
    expect(claims.email).toBe("u1@example.test");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueAccessToken(
      { sub: "u1", email: "u1@example.test", role: "user", kycTier: 0 },
      SECRET,
    );
    await expect(verifyAccessToken(token, "y".repeat(48))).rejects.toThrow();
  });

  it("refuses to sign with a short secret", async () => {
    await expect(
      issueAccessToken(
        { sub: "u1", email: "u1@example.test", role: "user", kycTier: 0 },
        "too-short",
      ),
    ).rejects.toThrow();
  });

  it("hashes refresh tokens deterministically", () => {
    const issued = issueRefreshToken();
    expect(hashRefreshToken(issued.token)).toBe(issued.tokenHash);
  });
});
