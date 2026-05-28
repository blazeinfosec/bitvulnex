import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  SECONDS_PER_YEAR,
  perSecondRate,
  utilization,
  accrueLinear,
} from "./yield";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("perSecondRate", () => {
  it("200 bps APY equals 0.02/SECONDS_PER_YEAR", () => {
    const r = perSecondRate(200);
    const expected = D("0.02").div(SECONDS_PER_YEAR);
    expect(r.toString()).toBe(expected.toString());
  });

  it("zero bps is zero", () => {
    expect(perSecondRate(0).toString()).toBe("0");
  });

  it("100% (10_000 bps) yields 1/SECONDS_PER_YEAR per second", () => {
    const r = perSecondRate(10_000);
    const product = r.mul(SECONDS_PER_YEAR);
    // High-precision Decimal arithmetic; allow a tiny rounding band.
    expect(Math.abs(Number(product.toString()) - 1)).toBeLessThan(1e-15);
  });
});

describe("utilization", () => {
  it("returns zero when nothing supplied", () => {
    expect(utilization(D(0), D(10)).toString()).toBe("0");
  });

  it("computes borrowed / supplied", () => {
    expect(utilization(D(100), D(60)).toString()).toBe("0.6");
  });

  it("can exceed 1 when overdrawn (caller clamps)", () => {
    expect(utilization(D(100), D(120)).toString()).toBe("1.2");
  });
});

describe("accrueLinear", () => {
  it("principal * rate * seconds", () => {
    const principal = D("1000");
    const rate = perSecondRate(200); // 2% APY
    const oneYearOfInterest = accrueLinear(principal, rate, SECONDS_PER_YEAR);
    // 1000 * 0.02 == 20
    expect(oneYearOfInterest.toString()).toBe("20");
  });

  it("scales linearly with seconds", () => {
    const a = accrueLinear(D(1), perSecondRate(1000), 60);
    const b = accrueLinear(D(1), perSecondRate(1000), 120);
    const ratio = Number(b.div(a).toString());
    expect(Math.abs(ratio - 2)).toBeLessThan(1e-12);
  });

  it("zero seconds yields zero interest", () => {
    expect(accrueLinear(D(1000), perSecondRate(500), 0).toString()).toBe("0");
  });
});
