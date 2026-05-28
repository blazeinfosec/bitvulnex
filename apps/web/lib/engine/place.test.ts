import { describe, it, expect } from "vitest";
import { placeOrder } from "./place";

// Validation tests for placeOrder. The validation guards run BEFORE
// any DB call, so we don't need to mock prisma -- the calls throw
// before reaching it.
//
// Phase-4 fix-up addressed:
//   Q-4.1 -- negative-amount balance-inflation (zod + in-fn check)
//   Q-4.6 -- unseeded pair acceptance (TradingPair lookup)
//   Q-4.10 -- empty-book market reject
//
// Full balance-conservation tests across place/match/cancel
// sequences are deferred to Phase 6 when the engine grows enough
// surface to justify a richer DI seam. The Phase-5 architect
// approved this scoping.

describe("placeOrder validation", () => {
  const baseArgs = {
    userId: "u1",
    pair: "BTC/USDT",
    side: "buy" as const,
    type: "limit" as const,
    price: "50000",
    amount: "1",
    feeTier: "base" as const,
  };

  it("rejects amount = 0", async () => {
    await expect(placeOrder({ ...baseArgs, amount: "0" })).rejects.toThrow(
      /amount must be > 0/,
    );
  });

  it("rejects negative amount via the in-function defense-in-depth", async () => {
    await expect(placeOrder({ ...baseArgs, amount: "-1" })).rejects.toThrow(
      /amount must be > 0/,
    );
  });

  it("rejects price <= 0 on a limit order", async () => {
    await expect(
      placeOrder({ ...baseArgs, type: "limit", price: "0" }),
    ).rejects.toThrow(/price must be > 0/);
  });

  it("rejects a malformed pair string", async () => {
    await expect(
      placeOrder({ ...baseArgs, pair: "BTCUSDT" }),
    ).rejects.toThrow(/bad pair/);
  });
});
