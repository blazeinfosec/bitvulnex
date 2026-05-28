// Repay a borrow position. Partial repayments are allowed; full
// repayment closes the position and unlocks collateral.

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type RepayArgs = {
  userId: string;
  positionId: string;
  amount: string;
};

export type RepayDb = Pick<
  typeof defaultPrisma,
  "balance" | "lendingPool" | "lendingPosition" | "$transaction"
>;

export async function repayBorrow(
  args: RepayArgs,
  db: RepayDb = defaultPrisma,
): Promise<{ closed: boolean }> {
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0)) throw new Error("amount must be > 0");

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const pos = await tx.lendingPosition.findFirst({
      where: {
        id: args.positionId,
        userId: args.userId,
        side: "borrow",
        status: "open",
      },
    });
    if (!pos) throw new Error("position not found");

    const owed = pos.principal.add(pos.accrued);
    const applied = amount.gt(owed) ? owed : amount;

    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: pos.pool } },
    });
    if (!bal || bal.available.lt(applied)) {
      throw new Error("insufficient balance to repay");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: pos.pool } },
      data: {
        available: { decrement: applied },
        amount: { decrement: applied },
      },
    });

    // Apply to accrued first (interest), then principal.
    let remainingAccrued = pos.accrued;
    let remainingPrincipal = pos.principal;
    let r = applied;
    if (r.gt(0)) {
      const payInterest = r.gt(remainingAccrued) ? remainingAccrued : r;
      remainingAccrued = remainingAccrued.sub(payInterest);
      r = r.sub(payInterest);
    }
    if (r.gt(0)) {
      const payPrincipal = r.gt(remainingPrincipal) ? remainingPrincipal : r;
      remainingPrincipal = remainingPrincipal.sub(payPrincipal);
      r = r.sub(payPrincipal);
    }

    const closed = remainingPrincipal.eq(0) && remainingAccrued.eq(0);

    await tx.lendingPosition.update({
      where: { id: pos.id },
      data: {
        principal: remainingPrincipal,
        accrued: remainingAccrued,
        status: closed ? "closed" : "open",
        closedAt: closed ? new Date() : null,
      },
    });

    // Decrement pool borrowed by the principal portion that was paid down.
    const principalPaid = pos.principal.sub(remainingPrincipal);
    if (principalPaid.gt(0)) {
      await tx.lendingPool.update({
        where: { asset: pos.pool },
        data: { borrowed: { decrement: principalPaid } },
      });
    }

    // On full close, release collateral back to spot.
    if (closed && pos.collateralAsset && pos.collateral) {
      await tx.balance.upsert({
        where: {
          userId_asset: { userId: args.userId, asset: pos.collateralAsset },
        },
        update: {
          available: { increment: pos.collateral },
          amount: { increment: pos.collateral },
        },
        create: {
          userId: args.userId,
          asset: pos.collateralAsset,
          available: pos.collateral,
          amount: pos.collateral,
        },
      });
    }

    return { closed };
  });
}
