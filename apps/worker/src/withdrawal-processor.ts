// Withdrawal processor. Runs on a short BullMQ schedule. Two phases:
//
//   1. pending → broadcast: pick up any pending withdrawal, ask the
//      mock node to `sendmany` to the destination address, record
//      the txid, advance status. Non-BTC assets have no node in the
//      lab, so they settle off-node with a synthetic reference.
//
//   2. broadcast/confirming/bumped → confirming/confirmed: poll
//      `gettransaction` for each in-flight withdrawal, advance status
//      based on confirmation count.

import { Prisma, prisma } from "@bvbe/db";

export type BitcoinClient = {
  sendmany(addressToAmount: Record<string, string>, feeSat: number): Promise<string>;
  gettransaction(txid: string): Promise<{ confirmations: number }>;
};

export type WithdrawalDb = Pick<
  typeof prisma,
  "withdrawal" | "balance" | "$transaction"
>;

// Confirmation threshold for moving a broadcast withdrawal to
// `confirmed`. The lab keeps this at 1 to keep e2e runs fast; real
// exchanges typically wait 3-6.
const CONFIRMED_THRESHOLD = 1;

// Only BTC is backed by the regtest mock node.
const ON_CHAIN_ASSETS = new Set(["BTC"]);

export async function processWithdrawalOnce(
  client: BitcoinClient,
  db: WithdrawalDb = prisma,
): Promise<{ broadcast: number; confirmed: number; failed: number }> {
  let broadcast = 0;
  let confirmed = 0;
  let failed = 0;

  const pending = await db.withdrawal.findMany({
    where: { status: "pending" },
    orderBy: { requestedAt: "asc" },
    take: 50,
  });
  for (const w of pending) {
    if (!ON_CHAIN_ASSETS.has(w.asset)) {
      const now = new Date();
      await db.withdrawal.update({
        where: { id: w.id },
        data: {
          status: "confirmed",
          txid: `offchain-${w.id}`,
          approvedAt: now,
          broadcastAt: now,
          confirmedAt: now,
        },
      });
      confirmed += 1;
      continue;
    }
    try {
      const txid = await client.sendmany(
        { [w.destAddress]: w.amount.toString() },
        100,
      );
      await db.withdrawal.update({
        where: { id: w.id },
        data: {
          status: "broadcast",
          txid,
          broadcastAt: new Date(),
          approvedAt: new Date(),
        },
      });
      broadcast += 1;
    } catch (e) {
      // The debit happened at submit time; give the funds back. Guard on
      // status so a concurrent user cancel (which also refunds) wins.
      const refund = (w.amount as Prisma.Decimal).add(w.fee as Prisma.Decimal);
      await db.$transaction(async (tx) => {
        const flipped = await tx.withdrawal.updateMany({
          where: { id: w.id, status: "pending" },
          data: {
            status: "failed",
            failedReason: e instanceof Error ? e.message : "rpc error",
          },
        });
        if (flipped.count === 0) return;
        await tx.balance.update({
          where: { userId_asset: { userId: w.userId, asset: w.asset } },
          data: {
            available: { increment: refund },
            amount: { increment: refund },
          },
        });
      });
      failed += 1;
    }
  }

  const inFlight = await db.withdrawal.findMany({
    where: { status: { in: ["broadcast", "confirming", "bumped"] } },
    take: 100,
  });
  for (const w of inFlight) {
    if (!w.txid) continue;
    const tx = await client.gettransaction(w.txid).catch(() => null);
    if (!tx) continue;
    if (tx.confirmations >= CONFIRMED_THRESHOLD) {
      await db.withdrawal.update({
        where: { id: w.id },
        data: { status: "confirmed", confirmedAt: new Date() },
      });
      confirmed += 1;
    } else if (tx.confirmations > 0 && w.status === "broadcast") {
      await db.withdrawal.update({
        where: { id: w.id },
        data: { status: "confirming" },
      });
    }
  }

  return { broadcast, confirmed, failed };
}
