// Withdrawal processor. Runs on a short BullMQ schedule. Two phases:
//
//   1. pending → broadcast: pick up any pending withdrawal, ask the
//      mock node to `sendmany` to the destination address, record
//      the txid, advance status.
//
//   2. broadcast/confirming → confirming/confirmed: poll
//      `gettransaction` for each in-flight withdrawal, advance status
//      based on confirmation count.

import { prisma } from "@bvbe/db";

export type BitcoinClient = {
  sendmany(addressToAmount: Record<string, string>, feeSat: number): Promise<string>;
  gettransaction(txid: string): Promise<{ confirmations: number }>;
};

export type WithdrawalDb = Pick<
  typeof prisma,
  "withdrawal"
>;

// Confirmation threshold for moving a broadcast withdrawal to
// `confirmed`. The lab keeps this at 1 to keep e2e runs fast; real
// exchanges typically wait 3-6.
const CONFIRMED_THRESHOLD = 1;

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
      await db.withdrawal.update({
        where: { id: w.id },
        data: {
          status: "failed",
          failedReason: e instanceof Error ? e.message : "rpc error",
        },
      });
      failed += 1;
    }
  }

  const inFlight = await db.withdrawal.findMany({
    where: { status: { in: ["broadcast", "confirming"] } },
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
