import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import { computeUserEquityUsd, type EquityInputs } from "./equity";

const D = (s: string | number) => new Prisma.Decimal(s);

function fixedPriceMap(prices: Record<string, string>) {
  return (asset: string) => {
    if (asset === "USDT" || asset === "USDC") return D("1");
    return prices[asset] ? D(prices[asset]!) : D("0");
  };
}

describe("computeUserEquityUsd", () => {
  it("sums spot + margin sub-account at USD prices", () => {
    const inputs: EquityInputs = {
      balances: [
        { asset: "BTC", amount: "0.5", marginAvailable: "0" },
        { asset: "USDT", amount: "1000", marginAvailable: "0" },
        { asset: "ETH", amount: "0", marginAvailable: "2" },
      ],
      lending: [],
      staking: [],
      margin: [],
      priceUsd: fixedPriceMap({ BTC: "60000", ETH: "3000" }),
    };
    // 0.5 * 60000 = 30000 + 1000 = 31000 + 2 * 3000 = 37000
    expect(computeUserEquityUsd(inputs).toString()).toBe("37000");
  });

  it("includes lending accrued in supply value (the L7 M-1 case)", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [
        { pool: "USDT", side: "supply", principal: "500", accrued: "12.34" },
      ],
      staking: [],
      margin: [],
      priceUsd: fixedPriceMap({}),
    };
    expect(computeUserEquityUsd(inputs).toString()).toBe("512.34");
  });

  it("treats borrow side as debt (negative contribution)", () => {
    const inputs: EquityInputs = {
      balances: [{ asset: "USDT", amount: "1000", marginAvailable: "0" }],
      lending: [
        { pool: "BTC", side: "borrow", principal: "0.01", accrued: "0.0001" },
      ],
      staking: [],
      margin: [],
      priceUsd: fixedPriceMap({ BTC: "60000" }),
    };
    // 1000 - (0.01 + 0.0001) * 60000 = 1000 - 606 = 394
    expect(computeUserEquityUsd(inputs).toString()).toBe("394");
  });

  it("counts staking principal at the asset price", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [],
      staking: [{ asset: "ETH", principal: "1.5" }],
      margin: [],
      priceUsd: fixedPriceMap({ ETH: "3000" }),
    };
    expect(computeUserEquityUsd(inputs).toString()).toBe("4500");
  });

  it("adds margin collateral and unrealized P&L (long winning)", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [],
      staking: [],
      margin: [
        {
          pair: "BTC/USDT",
          side: "long",
          size: "0.1",
          entryPrice: "60000",
          collateral: "1000",
          collateralAsset: "USDT",
          markPrice: "62000",
        },
      ],
      priceUsd: fixedPriceMap({ BTC: "62000" }),
    };
    // collateral 1000 + P&L 0.1 * (62000 - 60000) = 200 → 1200
    expect(computeUserEquityUsd(inputs).toString()).toBe("1200");
  });

  it("adds margin collateral and subtracts unrealized P&L (long losing)", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [],
      staking: [],
      margin: [
        {
          pair: "BTC/USDT",
          side: "long",
          size: "0.1",
          entryPrice: "60000",
          collateral: "1000",
          collateralAsset: "USDT",
          markPrice: "58000",
        },
      ],
      priceUsd: fixedPriceMap({ BTC: "58000" }),
    };
    // collateral 1000 + P&L 0.1 * (58000 - 60000) = -200 → 800
    expect(computeUserEquityUsd(inputs).toString()).toBe("800");
  });

  it("short positions invert P&L sign", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [],
      staking: [],
      margin: [
        {
          pair: "BTC/USDT",
          side: "short",
          size: "0.1",
          entryPrice: "60000",
          collateral: "1000",
          collateralAsset: "USDT",
          markPrice: "58000",
        },
      ],
      priceUsd: fixedPriceMap({ BTC: "58000" }),
    };
    // short P&L = 0.1 * (60000 - 58000) = +200 → 1200
    expect(computeUserEquityUsd(inputs).toString()).toBe("1200");
  });

  it("skips margin P&L when markPrice is null but still counts collateral", () => {
    const inputs: EquityInputs = {
      balances: [],
      lending: [],
      staking: [],
      margin: [
        {
          pair: "MOON/USDT",
          side: "long",
          size: "1",
          entryPrice: "1",
          collateral: "500",
          collateralAsset: "USDT",
          markPrice: null,
        },
      ],
      priceUsd: fixedPriceMap({}),
    };
    expect(computeUserEquityUsd(inputs).toString()).toBe("500");
  });

  it("zero-priced assets contribute zero (no crash)", () => {
    const inputs: EquityInputs = {
      balances: [{ asset: "MOON", amount: "1000000", marginAvailable: "0" }],
      lending: [],
      staking: [],
      margin: [],
      priceUsd: fixedPriceMap({}),
    };
    expect(computeUserEquityUsd(inputs).toString()).toBe("0");
  });

  it("composite: spot + lending + staking + margin all flow together", () => {
    const inputs: EquityInputs = {
      balances: [
        { asset: "BTC", amount: "0.1", marginAvailable: "0" },
        { asset: "USDT", amount: "5000", marginAvailable: "2000" },
      ],
      lending: [
        { pool: "USDT", side: "supply", principal: "1000", accrued: "5" },
      ],
      staking: [{ asset: "ETH", principal: "2" }],
      margin: [
        {
          pair: "BTC/USDT",
          side: "long",
          size: "0.05",
          entryPrice: "60000",
          collateral: "600",
          collateralAsset: "USDT",
          markPrice: "62000",
        },
      ],
      priceUsd: fixedPriceMap({ BTC: "62000", ETH: "3000" }),
    };
    // BTC: 0.1 * 62000 = 6200
    // USDT spot: 5000
    // USDT margin-avail: 2000
    // lending supply: 1000+5 = 1005
    // staking: 2 * 3000 = 6000
    // margin collateral: 600
    // margin P&L: 0.05 * (62000-60000) * 1 = 100
    // total: 6200 + 5000 + 2000 + 1005 + 6000 + 600 + 100 = 20905
    expect(computeUserEquityUsd(inputs).toString()).toBe("20905");
  });
});
