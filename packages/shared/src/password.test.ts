import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const stored = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", stored)).toBe(
      true,
    );
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a different hash each call (random salt)", async () => {
    const a = await hashPassword("pw");
    const b = await hashPassword("pw");
    expect(a).not.toBe(b);
  });
});
