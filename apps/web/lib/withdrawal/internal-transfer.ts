// Internal transfer. Fee-free peer-to-peer move within BVBE,
// designed for OTC desk client servicing and direct B2B settlement
// between onboarded users. Sender and recipient must both have an
// account; the move never touches the blockchain.
//
// The transfer is atomic: sender debit and recipient credit happen
// in a single Prisma transaction so a partial failure can't leave
// the books inconsistent.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { requireKnownAsset } from "../assets";

export class TransferValidationError extends Error {
  readonly status = 400;
}

export class InsufficientBalanceError extends Error {
  readonly status = 400;
}

export type TransferArgs = {
  fromUserId: string;
  toUserEmail: string;
  asset: string;
  amount: string;
  memo?: string;
};

export type TransferResult = {
  transferId: string;
  amount: string;
  asset: string;
};

export async function internalTransfer(
  args: TransferArgs,
  db: typeof defaultPrisma = defaultPrisma,
): Promise<TransferResult> {
  requireKnownAsset(args.asset);

  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) {
    throw new TransferValidationError("amount must be > 0");
  }

  const recipient = await db.user.findUnique({
    where: { email: args.toUserEmail.toLowerCase() },
    select: { id: true },
  });
  if (!recipient) {
    throw new TransferValidationError("recipient not found");
  }
  if (recipient.id === args.fromUserId) {
    throw new TransferValidationError("cannot transfer to self");
  }

  return db.$transaction(async (tx) => {
    const sender = await tx.balance.findUnique({
      where: {
        userId_asset: { userId: args.fromUserId, asset: args.asset },
      },
    });
    if (!sender || sender.available.lt(amount)) {
      throw new InsufficientBalanceError("insufficient balance");
    }

    await tx.balance.update({
      where: {
        userId_asset: { userId: args.fromUserId, asset: args.asset },
      },
      data: {
        available: { decrement: amount },
        amount: { decrement: amount },
      },
    });

    await tx.balance.upsert({
      where: {
        userId_asset: { userId: recipient.id, asset: args.asset },
      },
      create: {
        userId: recipient.id,
        asset: args.asset,
        amount,
        available: amount,
      },
      update: {
        available: { increment: amount },
        amount: { increment: amount },
      },
    });

    const row = await tx.internalTransfer.create({
      data: {
        fromUserId: args.fromUserId,
        toUserId: recipient.id,
        asset: args.asset,
        amount,
        memo: args.memo ?? null,
      },
    });

    return {
      transferId: row.id,
      amount: amount.toString(),
      asset: args.asset,
    };
  });
}
