import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  breachesMaintenance,
  keeperRebate,
  liquidationPriceFor,
  unrealizedPnl,
} from "./margin";

const D = (s: string) => new Prisma.Decimal(s);

describe("liquidationPriceFor", () => {
  it("long with 2× leverage and $50k entry liquidates near $25,250", () => {
    // 5 BTC at $50k = $250k notional, 2× lev → collateral = $125k.
    // Maintenance buffer = 250k * 0.5% = $1,250.
    // Loss = $125k - $1,250 = $123,750. priceDelta = $123,750 / 5 = $24,750.
    // liqPrice = 50000 - 24750 = $25,250.
    const liq = liquidationPriceFor("long", D("50000"), D("5"), D("125000"));
    expect(liq.toString()).toBe("25250");
  });

  it("short flips the sign of priceDelta", () => {
    const liq = liquidationPriceFor("short", D("50000"), D("5"), D("125000"));
    expect(liq.toString()).toBe("74750");
  });
});

describe("breachesMaintenance", () => {
  const longPos = {
    side: "long" as const,
    size: D("1"),
    entryPrice: D("50000"),
    collateral: D("10000"), // 5× leverage notionally
  };

  it("mark above entry: long not breached", () => {
    expect(breachesMaintenance(longPos, D("51000"))).toBe(false);
  });

  it("mark at liquidation: long IS breached", () => {
    const liq = liquidationPriceFor(
      longPos.side,
      longPos.entryPrice,
      longPos.size,
      longPos.collateral,
    );
    expect(breachesMaintenance(longPos, liq)).toBe(true);
  });

  it("short breaches when mark rises", () => {
    const shortPos = { ...longPos, side: "short" as const };
    const liq = liquidationPriceFor(
      shortPos.side,
      shortPos.entryPrice,
      shortPos.size,
      shortPos.collateral,
    );
    expect(breachesMaintenance(shortPos, liq)).toBe(true);
    expect(breachesMaintenance(shortPos, D("49000"))).toBe(false);
  });
});

describe("unrealizedPnl", () => {
  it("long gains when mark > entry", () => {
    const p = { side: "long" as const, size: D("2"), entryPrice: D("100") };
    expect(unrealizedPnl(p, D("110")).toString()).toBe("20");
  });

  it("short gains when mark < entry", () => {
    const p = { side: "short" as const, size: D("2"), entryPrice: D("100") };
    expect(unrealizedPnl(p, D("90")).toString()).toBe("20");
  });
});

describe("keeperRebate", () => {
  it("returns 50bps of collateral", () => {
    expect(keeperRebate(D("10000")).toString()).toBe("50");
  });
});
