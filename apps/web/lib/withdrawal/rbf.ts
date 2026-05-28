// RBF fee bump. Treasury/admin operators call this when a withdrawal
// transaction is stuck in the mempool at too low a fee and they want
// to replace it with one paying a different fee.
//
// The mock node's `bumpfee` drops the original TX, issues a
// replacement at the new fee, and returns the new txid. When the new
// fee is lower than the original, the difference is refunded to the
// user's available balance — they originally paid the higher fee
// from their balance at submit-time, so lowering it should give the
// delta back.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { rpc } from "../btc-rpc-client";

const SATS_PER_BTC = 100_000_000;

export class BumpValidationError extends Error {
  readonly status = 400;
}

export class NotFoundError extends Error {
  readonly status = 404;
}

export type BumpArgs = {
  withdrawalId: string;
  newFeeSat: number;
  operatorUserId: string;
};

export async function bumpWithdrawalFee(
  args: BumpArgs,
  db: typeof defaultPrisma = defaultPrisma,
): Promise<{ replacedByTxid: string; refundBtc: string }> {
  const w = await db.withdrawal.findUnique({
    where: { id: args.withdrawalId },
  });
  if (!w) throw new NotFoundError("not found");
  if (w.status !== "broadcast" && w.status !== "confirming") {
    throw new BumpValidationError("withdrawal not bumpable");
  }
  if (!w.txid) {
    throw new BumpValidationError("no txid on record");
  }

  const oldFeeSat = Math.round(
    Number((w.fee as Prisma.Decimal).toString()) * SATS_PER_BTC,
  );
  const feeDelta = oldFeeSat - args.newFeeSat;

  const replacement = await rpc<{ txid: string }>("bumpfee", [
    w.txid,
    args.newFeeSat,
  ]);

  // If the new fee is lower than the old fee, the user paid too much
  // at submit-time and we credit the delta back to their available
  // balance.
  let refundBtc = new Prisma.Decimal(0);
  if (feeDelta > 0) {
    refundBtc = new Prisma.Decimal(feeDelta).div(SATS_PER_BTC);
    await db.balance.update({
      where: { userId_asset: { userId: w.userId, asset: w.asset } },
      data: {
        available: { increment: refundBtc },
        amount: { increment: refundBtc },
      },
    });
  }

  const newFeeBtc = new Prisma.Decimal(args.newFeeSat).div(SATS_PER_BTC);
  await db.withdrawal.update({
    where: { id: w.id },
    data: {
      status: "bumped",
      replacedByTxid: replacement.txid,
      txid: replacement.txid,
      fee: newFeeBtc,
    },
  });

  return { replacedByTxid: replacement.txid, refundBtc: refundBtc.toString() };
}
