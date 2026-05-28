// Yield math. Pure functions, no I/O. Shared between the lending
// supply/borrow surfaces, the staking reward calculator, and the
// worker's interest accrual loop so the rate formulas live in one
// place.

import { Prisma } from "@bvbe/db";

export const SECONDS_PER_YEAR = 31_536_000;

const BPS_DIVISOR = new Prisma.Decimal(10_000);
const YEAR = new Prisma.Decimal(SECONDS_PER_YEAR);

/**
 * Convert an APY in basis points to a per-second rate.
 *   200 bps APY → 0.02 / 31_536_000 ≈ 6.34e-10 per second.
 */
export function perSecondRate(apyBps: number): Prisma.Decimal {
  return new Prisma.Decimal(apyBps).div(BPS_DIVISOR).div(YEAR);
}

/**
 * Pool utilization in [0, 1]. Returns zero when nothing is supplied.
 * Borrowed greater than supplied is clamped to 1 at the caller; this
 * function reports the raw ratio so the caller can decide.
 */
export function utilization(
  supplied: Prisma.Decimal,
  borrowed: Prisma.Decimal,
): Prisma.Decimal {
  if (supplied.lte(0)) return new Prisma.Decimal(0);
  return borrowed.div(supplied);
}

/**
 * Linear accrual: principal * ratePerSec * seconds. Compounding is
 * achieved by calling this once per tick and folding the result back
 * into principal at the next tick if desired.
 */
export function accrueLinear(
  principal: Prisma.Decimal,
  ratePerSec: Prisma.Decimal,
  seconds: number,
): Prisma.Decimal {
  return principal.mul(ratePerSec).mul(seconds);
}
