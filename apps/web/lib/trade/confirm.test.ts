import { describe, it, expect } from "vitest";
import { shouldConfirm } from "./confirm";

describe("shouldConfirm", () => {
  it("returns no triggers for a small limit order", () => {
    const t = shouldConfirm({
      type: "limit",
      side: "buy",
      amount: 0.001,
      price: 67_000,
      lastPrice: 67_000,
      available: 10_000, // USDT
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toEqual([]);
  });

  it("flags large-fraction-of-balance when buy notional > 10% of quote available", () => {
    // 1 BTC * 67k = 67k USDT notional, available 100k → 67% > 10% ✔
    const t = shouldConfirm({
      type: "limit",
      side: "buy",
      amount: 1,
      price: 67_000,
      lastPrice: 67_000,
      available: 100_000,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toContain("large-fraction-of-balance");
  });

  it("flags large-fraction-of-balance for a sell using base available", () => {
    // selling 0.5 BTC, base available 1 → 50% > 10% ✔
    const t = shouldConfirm({
      type: "limit",
      side: "sell",
      amount: 0.5,
      price: 67_000,
      lastPrice: 67_000,
      available: 1,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toContain("large-fraction-of-balance");
  });

  it("flags large-market-notional when market order > $1000 (USD-stable quote)", () => {
    const t = shouldConfirm({
      type: "market",
      side: "buy",
      amount: 0.05,
      price: null,
      lastPrice: 67_000, // notional 3350 USDT > 1000 ✔
      available: 1_000_000,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toContain("large-market-notional");
  });

  it("uses quoteToUsdRate to convert non-stable quote for the $1000 test", () => {
    // ETH/BTC, market buy 0.5 ETH at 0.05 BTC → 0.025 BTC notional.
    // 0.025 BTC * 67_000 USD/BTC = 1675 USD > 1000 ✔
    const t = shouldConfirm({
      type: "market",
      side: "buy",
      amount: 0.5,
      price: null,
      lastPrice: 0.05,
      available: 10,
      quoteIsUsdStable: false,
      quoteToUsdRate: 67_000,
    });
    expect(t).toContain("large-market-notional");
  });

  it("does not flag market notional below $1000", () => {
    const t = shouldConfirm({
      type: "market",
      side: "buy",
      amount: 0.001,
      price: null,
      lastPrice: 67_000, // 67 USDT
      available: 1_000_000,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).not.toContain("large-market-notional");
  });

  it("returns empty when amount or price is invalid", () => {
    const t = shouldConfirm({
      type: "limit",
      side: "buy",
      amount: 0,
      price: 67_000,
      lastPrice: 67_000,
      available: 100,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toEqual([]);
  });

  // Fence-post tests: the rule is strict greater-than for both
  // thresholds. A debit exactly at 10% of available must NOT trigger;
  // any whisker over 10% must. Same for $1000 on market notionals.
  it("does NOT flag large-fraction-of-balance at exactly 10% of available", () => {
    // buy 0.1 BTC at 1 USDT each → 0.1 USDT notional, available 1 → 10.0% exactly.
    const t = shouldConfirm({
      type: "limit",
      side: "buy",
      amount: 0.1,
      price: 1,
      lastPrice: 1,
      available: 1,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).not.toContain("large-fraction-of-balance");
  });

  it("flags large-fraction-of-balance just over 10% of available", () => {
    // buy 0.1000001 BTC at 1 USDT → 0.1000001 / 1 = 10.00001% > 10%.
    const t = shouldConfirm({
      type: "limit",
      side: "buy",
      amount: 0.1000001,
      price: 1,
      lastPrice: 1,
      available: 1,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toContain("large-fraction-of-balance");
  });

  it("does NOT flag large-market-notional at exactly $1000", () => {
    // market 0.01 BTC at 100_000 = exactly 1000 USDT (stable).
    const t = shouldConfirm({
      type: "market",
      side: "buy",
      amount: 0.01,
      price: null,
      lastPrice: 100_000,
      available: 1_000_000,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).not.toContain("large-market-notional");
  });

  it("flags large-market-notional just over $1000", () => {
    // 0.010001 BTC * 100_000 = 1000.10 USDT.
    const t = shouldConfirm({
      type: "market",
      side: "buy",
      amount: 0.010001,
      price: null,
      lastPrice: 100_000,
      available: 1_000_000,
      quoteIsUsdStable: true,
      quoteToUsdRate: null,
    });
    expect(t).toContain("large-market-notional");
  });
});
