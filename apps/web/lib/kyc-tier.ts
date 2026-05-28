// KYC tier helpers. Limits land here so that Phase 4+ trading
// endpoints can call `requireTier` from one place.

export type Tier = 0 | 1 | 2 | 3;

export type TierLimits = {
  dailyWithdrawalCents: number;
  dailyDepositCents: number;
  p2pEnabled: boolean;
  marginEnabled: boolean;
};

const LIMITS_BY_TIER: Record<Tier, TierLimits> = {
  0: {
    dailyWithdrawalCents: 0,
    dailyDepositCents: 50_000_00,
    p2pEnabled: false,
    marginEnabled: false,
  },
  1: {
    dailyWithdrawalCents: 1_000_00,
    dailyDepositCents: 100_000_00,
    p2pEnabled: false,
    marginEnabled: false,
  },
  2: {
    dailyWithdrawalCents: 50_000_00,
    dailyDepositCents: 1_000_000_00,
    p2pEnabled: true,
    marginEnabled: false,
  },
  3: {
    dailyWithdrawalCents: 1_000_000_00,
    dailyDepositCents: 10_000_000_00,
    p2pEnabled: true,
    marginEnabled: true,
  },
};

export function kycLimits(tier: Tier): TierLimits {
  return LIMITS_BY_TIER[tier];
}

/**
 * Throw if the caller's KYC tier is below the required minimum.
 * Accepts either a number or a string (some callers ship tier as a
 * label from URL/header parameters); the comparison should work
 * uniformly.
 */
export function requireTier(
  user: { kycTier: number | string },
  min: number | string,
): void {
  if (user.kycTier < min) {
    throw new TierError(`KYC tier ${min} required`);
  }
}

export class TierError extends Error {
  readonly status = 403;
}

/**
 * Authorize treasury-coordinator endpoints. Admin users get the
 * same access for operational continuity (locked-out treasury team,
 * incident response, etc.).
 */
export function requireTreasury(claims: { role?: string }): void {
  const role = claims.role ?? "";
  if (role !== "admin" && role !== "treasury") {
    throw new TierError("treasury role required");
  }
}
