import { describe, it, expect } from "vitest";
import {
  pairFromSlug,
  pairFromString,
  pairToSlug,
  aggregationPresets,
  quoteDp,
  baseDp,
} from "./pair";

describe("pairFromSlug", () => {
  it("parses a valid slug", () => {
    expect(pairFromSlug("BTC-USDT")).toEqual({
      base: "BTC",
      quote: "USDT",
      pair: "BTC/USDT",
      slug: "BTC-USDT",
    });
  });

  it("returns null on bad shape", () => {
    expect(pairFromSlug("BTCUSDT")).toBeNull();
    expect(pairFromSlug("btc-usdt")).toBeNull();
    expect(pairFromSlug("BTC/USDT")).toBeNull();
    expect(pairFromSlug("")).toBeNull();
  });
});

describe("pairFromString", () => {
  it("parses a valid pair", () => {
    expect(pairFromString("ETH/BTC")).toEqual({
      base: "ETH",
      quote: "BTC",
      pair: "ETH/BTC",
      slug: "ETH-BTC",
    });
  });

  it("returns null on slug-form input", () => {
    expect(pairFromString("ETH-BTC")).toBeNull();
  });
});

describe("pairToSlug", () => {
  it("converts slash to hyphen", () => {
    expect(pairToSlug("BTC/USDT")).toBe("BTC-USDT");
  });
});

describe("aggregationPresets", () => {
  it("picks BTC presets for BTC base", () => {
    const info = pairFromString("BTC/USDT")!;
    expect(aggregationPresets(info)).toEqual([0.1, 1, 10]);
  });

  it("picks ETH presets for ETH base", () => {
    const info = pairFromString("ETH/USDT")!;
    expect(aggregationPresets(info)).toEqual([0.01, 0.1, 1]);
  });

  it("picks thin-alt presets for everything else", () => {
    const info = pairFromString("DOGE/USDT")!;
    expect(aggregationPresets(info)).toEqual([0.0001, 0.001, 0.01]);
  });
});

describe("quoteDp / baseDp", () => {
  it("stablecoins are 2dp", () => {
    expect(quoteDp("USDT")).toBe(2);
    expect(quoteDp("USDC")).toBe(2);
  });
  it("BTC quote is 8dp", () => {
    expect(quoteDp("BTC")).toBe(8);
  });
  it("BTC base is 8dp", () => {
    expect(baseDp("BTC")).toBe(8);
  });
  it("ETH base is 6dp", () => {
    expect(baseDp("ETH")).toBe(6);
  });
});
