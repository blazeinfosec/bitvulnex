// Submit a user withdrawal. Validates the destination address against
// the Bitvulnex address parser, runs the daily limit check, debits the
// available balance, and stores a `pending` Withdrawal row. The
// withdrawal worker picks the row up on its next tick.
//
// The fee is a flat network fee — real exchanges price this
// dynamically off mempool; the lab uses a fixed value.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { isValidBtcAddress, normalizeBtcAddress } from "@bvbe/shared";
import { requireKnownAsset } from "../assets";
import { type Tier } from "../kyc-tier";
import {
  LimitExceededError,
  amountToCents,
  checkAndDebitLimit,
} from "./limit";
import { isUserFrozen } from "./freeze";

export class WithdrawalValidationError extends Error {
  readonly status = 400;
}

export class InsufficientBalanceError extends Error {
  readonly status = 400;
}

export class AccountFrozenError extends Error {
  readonly status = 423;
}

// Flat network fee per BTC withdrawal. Real exchanges quote this off
// the live mempool; the lab pins it for determinism.
const NETWORK_FEE_BTC: Record<string, string> = {
  BTC: "0.00010000",
  ETH: "0.001",
  LTC: "0.001",
  USDT: "1.0",
  USDC: "1.0",
  DOGE: "1.0",
};

export type SubmitArgs = {
  userId: string;
  tier: Tier;
  asset: string;
  amount: string;
  destAddress: string;
  // Lab-affordance-only effective timestamp for the daily-limit window
  // (see checkAndDebitLimit). Undefined in normal operation.
  now?: Date;
};

export type SubmitResult = {
  withdrawalId: string;
  amount: string;
  fee: string;
  destAddress: string;
};

export async function submitWithdrawal(
  args: SubmitArgs,
  db: typeof defaultPrisma = defaultPrisma,
): Promise<SubmitResult> {
  requireKnownAsset(args.asset);

  const dest = normalizeBtcAddress(args.destAddress);
  if (!isValidBtcAddress(dest)) {
    throw new WithdrawalValidationError("invalid destination address");
  }

  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) {
    throw new WithdrawalValidationError("amount must be > 0");
  }

  const fee = new Prisma.Decimal(NETWORK_FEE_BTC[args.asset] ?? "0");
  const totalDebit = amount.add(fee);

  if (await isUserFrozen(args.userId, db)) {
    throw new AccountFrozenError("account frozen");
  }

  // Available balance check — does the user have enough liquid funds
  // to cover the withdrawal plus the network fee?
  const balance = await db.balance.findUnique({
    where: { userId_asset: { userId: args.userId, asset: args.asset } },
  });
  if (!balance || balance.available.lt(totalDebit)) {
    throw new InsufficientBalanceError("insufficient balance");
  }

  // Daily limit ledger — separately tracked from balance.
  await checkAndDebitLimit(
    {
      userId: args.userId,
      tier: args.tier,
      asset: args.asset,
      amountCents: amountToCents(args.asset, amount),
      now: args.now,
    },
    db,
  );

  // Debit the available balance and persist the pending Withdrawal.
  await db.balance.update({
    where: { userId_asset: { userId: args.userId, asset: args.asset } },
    data: {
      available: { decrement: totalDebit },
      amount: { decrement: totalDebit },
    },
  });

  const withdrawal = await db.withdrawal.create({
    data: {
      userId: args.userId,
      asset: args.asset,
      amount,
      fee,
      destAddress: dest,
      status: "pending",
    },
  });

  return {
    withdrawalId: withdrawal.id,
    amount: amount.toString(),
    fee: fee.toString(),
    destAddress: dest,
  };
}

export { LimitExceededError };
