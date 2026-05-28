// Cancel a pending/approved withdrawal. Refunds the user's available
// balance (amount + fee) in the same transaction as the status flip
// so the books reconcile.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";
import { creditBackLimit, amountToCents } from "./limit";

export class CancelValidationError extends Error {
  readonly status = 400;
}

export class NotFoundError extends Error {
  readonly status = 404;
}

export async function cancelWithdrawal(
  args: { withdrawalId: string; userId: string },
  db: typeof defaultPrisma = defaultPrisma,
): Promise<{ ok: true }> {
  const w = await db.withdrawal.findUnique({
    where: { id: args.withdrawalId },
  });
  if (!w) throw new NotFoundError("not found");
  if (w.userId !== args.userId) throw new NotFoundError("not found");
  if (w.status !== "pending" && w.status !== "approved") {
    throw new CancelValidationError("withdrawal cannot be cancelled");
  }

  const refund = (w.amount as Prisma.Decimal).add(w.fee as Prisma.Decimal);

  await db.$transaction(async (tx) => {
    const flipped = await tx.withdrawal.updateMany({
      where: { id: w.id, status: { in: ["pending", "approved"] } },
      data: { status: "rejected", failedReason: "cancelled by user" },
    });
    if (flipped.count === 0) {
      throw new CancelValidationError("withdrawal cannot be cancelled");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: w.userId, asset: w.asset } },
      data: {
        available: { increment: refund },
        amount: { increment: refund },
      },
    });
  });

  // Refund the limit ledger so the cancelled amount doesn't continue
  // counting toward the day's running total.
  await creditBackLimit(
    {
      userId: w.userId,
      asset: w.asset,
      amountCents: amountToCents(w.asset, w.amount as Prisma.Decimal),
      at: w.requestedAt,
    },
    db,
  );

  return { ok: true };
}
