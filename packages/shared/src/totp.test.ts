import { describe, it, expect } from "vitest";
import { generateTotpSecret, totpCode, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("a freshly-generated secret verifies its own current code", () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "000000")).toBe(false);
  });
});
