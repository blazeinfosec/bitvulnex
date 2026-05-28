import { describe, it, expect } from "vitest";
import { kycLimits } from "./kyc-tier";

describe("kycLimits", () => {
  it("returns tier-0 unverified limits", () => {
    const l = kycLimits(0);
    expect(l.dailyWithdrawalCents).toBe(0);
    expect(l.p2pEnabled).toBe(false);
    expect(l.marginEnabled).toBe(false);
  });

  it("returns tier-3 unlocks margin + p2p", () => {
    const l = kycLimits(3);
    expect(l.marginEnabled).toBe(true);
    expect(l.p2pEnabled).toBe(true);
  });

  it("withdrawal caps strictly increase with tier", () => {
    expect(kycLimits(0).dailyWithdrawalCents).toBeLessThan(
      kycLimits(1).dailyWithdrawalCents,
    );
    expect(kycLimits(1).dailyWithdrawalCents).toBeLessThan(
      kycLimits(2).dailyWithdrawalCents,
    );
    expect(kycLimits(2).dailyWithdrawalCents).toBeLessThan(
      kycLimits(3).dailyWithdrawalCents,
    );
  });
});
