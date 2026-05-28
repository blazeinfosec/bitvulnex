import { describe, it, expect } from "vitest";
import { isValidBtcAddress, normalizeBtcAddress } from "./btc-address";

describe("isValidBtcAddress", () => {
  it("accepts legacy mainnet P2PKH (starts with 1)", () => {
    expect(isValidBtcAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
  });

  it("accepts legacy P2SH (starts with 3)", () => {
    expect(isValidBtcAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true);
  });

  it("accepts regtest legacy (starts with m / n / 2)", () => {
    expect(isValidBtcAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")).toBe(true);
    expect(isValidBtcAddress("2N2JD6wb56AfK4tfmM6PwdVmoYk2dCKf4Br")).toBe(true);
  });

  it("rejects the empty string and obvious garbage", () => {
    expect(isValidBtcAddress("")).toBe(false);
    expect(isValidBtcAddress("not-an-address")).toBe(false);
  });
});

describe("normalizeBtcAddress", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeBtcAddress("  bc1qfoo  ")).toBe("bc1qfoo");
  });
});
