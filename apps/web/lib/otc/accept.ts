// OTC ticket acceptance. The matcher is clean and fee-agnostic — the
// caller supplies feeBps from whichever policy applies to the desk
// relationship (standard taker fee for retail flow, negotiated zero
// or low fee for institutional makers).

import { Prisma, prisma as defaultPrisma } from "@bvbe/db";

export type AcceptArgs = {
  userId: string;
  ticketId: string;
  feeBps: number;
};

export type AcceptDb = Pick<
  typeof defaultPrisma,
  "balance" | "otcTicket" | "$transaction"
>;

export async function acceptOtc(
  args: AcceptArgs,
  db: AcceptDb = defaultPrisma,
): Promise<{ filled: boolean; baseDelta: string; quoteDelta: string }> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const ticket = await tx.otcTicket.findUnique({
      where: { id: args.ticketId },
    });
    if (!ticket) throw new Error("ticket not found");
    if (ticket.userId !== args.userId) throw new Error("not your ticket");
    if (ticket.status !== "quoted") throw new Error("ticket not quotable");
    if (!ticket.quotedPrice) throw new Error("ticket has no price");
    if (ticket.quoteExpiresAt && ticket.quoteExpiresAt.getTime() < Date.now()) {
      await tx.otcTicket.update({
        where: { id: ticket.id },
        data: { status: "expired" },
      });
      throw new Error("quote expired");
    }

    const [base, quote] = ticket.pair.split("/");
    if (!base || !quote) throw new Error("bad pair");

    const notional = ticket.amount.mul(ticket.quotedPrice);
    const fee = notional.mul(args.feeBps).div(10_000);

    if (ticket.side === "buy") {
      // Caller spends quote (notional + fee), receives base.
      const bal = await tx.balance.findUnique({
        where: { userId_asset: { userId: args.userId, asset: quote } },
      });
      const cost = notional.add(fee);
      if (!bal || bal.available.lt(cost)) {
        throw new Error("insufficient quote balance");
      }
      await tx.balance.update({
        where: { userId_asset: { userId: args.userId, asset: quote } },
        data: {
          available: { decrement: cost },
          amount: { decrement: cost },
        },
      });
      await tx.balance.upsert({
        where: { userId_asset: { userId: args.userId, asset: base } },
        update: {
          available: { increment: ticket.amount },
          amount: { increment: ticket.amount },
        },
        create: {
          userId: args.userId,
          asset: base,
          available: ticket.amount,
          amount: ticket.amount,
        },
      });
      await tx.otcTicket.update({
        where: { id: ticket.id },
        data: {
          status: "filled",
          filledAt: new Date(),
          feeBps: args.feeBps,
        },
      });
      return {
        filled: true,
        baseDelta: ticket.amount.toString(),
        quoteDelta: cost.neg().toString(),
      };
    }

    // Sell: caller spends base, receives quote minus fee.
    const bal = await tx.balance.findUnique({
      where: { userId_asset: { userId: args.userId, asset: base } },
    });
    if (!bal || bal.available.lt(ticket.amount)) {
      throw new Error("insufficient base balance");
    }
    await tx.balance.update({
      where: { userId_asset: { userId: args.userId, asset: base } },
      data: {
        available: { decrement: ticket.amount },
        amount: { decrement: ticket.amount },
      },
    });
    const proceeds = notional.sub(fee);
    await tx.balance.upsert({
      where: { userId_asset: { userId: args.userId, asset: quote } },
      update: {
        available: { increment: proceeds },
        amount: { increment: proceeds },
      },
      create: {
        userId: args.userId,
        asset: quote,
        available: proceeds,
        amount: proceeds,
      },
    });
    await tx.otcTicket.update({
      where: { id: ticket.id },
      data: {
        status: "filled",
        filledAt: new Date(),
        feeBps: args.feeBps,
      },
    });
    return {
      filled: true,
      baseDelta: ticket.amount.neg().toString(),
      quoteDelta: proceeds.toString(),
    };
  });
}

