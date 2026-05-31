// Daily withdrawal limit ledger. One row per (user, UTC day, asset)
// keeps the running total of debited value attributed to that day so
// the limit check is a single indexed read.
//
// The limit is sourced from `kycLimits(tier).dailyWithdrawalCents`.
// For BTC we use a fixed USD-equivalent reference price so the
// limit is denominated in the same unit as the KYC ledger (cents).

import { prisma as defaultPrisma, type Prisma } from "@bvbe/db";
import { kycLimits, type Tier } from "../kyc-tier";

// USD-equivalent reference price per asset, in cents. Used to convert
// asset amounts into the cents-denominated limit ledger. The lab uses
// fixed reference prices rather than a live oracle so the limit
// behaviour is deterministic across test runs.
const REFERENCE_PRICE_CENTS_PER_UNIT: Record<string, number> = {
  BTC: 60_000_00,
  ETH: 3_000_00,
  LTC: 80_00,
  DOGE: 0,
  USDT: 1_00,
  USDC: 1_00,
};

export class LimitExceededError extends Error {
  readonly status = 429;
}

/**
 * Truncate `now` to the start of its UTC day. Withdrawals submitted
 * across midnight UTC land in separate ledger rows.
 */
export function currentDayUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function amountToCents(asset: string, amount: Prisma.Decimal): number {
  const ref = REFERENCE_PRICE_CENTS_PER_UNIT[asset] ?? 0;
  // Two-step convert avoids floating-point on the Decimal: multiply
  // by the reference price (cents per whole unit), then floor the
  // result. amount is in whole asset units (BTC, ETH, …).
  return Math.floor(Number(amount.toString()) * ref);
}

type LedgerDb = Pick<
  typeof defaultPrisma,
  "withdrawalLimitLedger"
>;

export async function checkAndDebitLimit(
  args: {
    userId: string;
    tier: Tier;
    asset: string;
    amountCents: number;
    // Optional effective timestamp for the limit window. Defaults to
    // the real clock; only overridden by the lab affordance (gated on
    // LAB_AFFORDANCES_ENABLED) so the UTC-midnight reset can be
    // demonstrated without waiting for or moving the system clock.
    // The calendar-day bucketing itself is unchanged.
    now?: Date;
  },
  db: LedgerDb = defaultPrisma,
): Promise<void> {
  const today = currentDayUtc(args.now ?? new Date());
  const limitCents = kycLimits(args.tier).dailyWithdrawalCents;

  const existing = await db.withdrawalLimitLedger.findUnique({
    where: {
      userId_utcDate_asset: {
        userId: args.userId,
        utcDate: today,
        asset: args.asset,
      },
    },
  });
  const currentTotal = existing ? Number(existing.totalCents) : 0;
  if (currentTotal + args.amountCents > limitCents) {
    throw new LimitExceededError("daily withdrawal limit");
  }

  await db.withdrawalLimitLedger.upsert({
    where: {
      userId_utcDate_asset: {
        userId: args.userId,
        utcDate: today,
        asset: args.asset,
      },
    },
    create: {
      userId: args.userId,
      utcDate: today,
      asset: args.asset,
      totalCents: BigInt(args.amountCents),
    },
    update: {
      totalCents: { increment: BigInt(args.amountCents) },
    },
  });
}

export async function creditBackLimit(
  args: {
    userId: string;
    asset: string;
    amountCents: number;
    at: Date;
  },
  db: LedgerDb = defaultPrisma,
): Promise<void> {
  const day = currentDayUtc(args.at);
  const row = await db.withdrawalLimitLedger.findUnique({
    where: {
      userId_utcDate_asset: {
        userId: args.userId,
        utcDate: day,
        asset: args.asset,
      },
    },
  });
  if (!row) return;
  const next = Number(row.totalCents) - args.amountCents;
  await db.withdrawalLimitLedger.update({
    where: { id: row.id },
    data: { totalCents: BigInt(Math.max(0, next)) },
  });
}
