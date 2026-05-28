// Deposit watcher. Polls bitcoin-mock for each watched address and
// reconciles to the Deposit + Balance tables.

import { prisma } from "@bvbe/db";

export type WatchTx = {
  txid: string;
  vout: number;
  amountBtc: number;
  confirmations: number;
};

export type RpcClient = {
  watch(address: string): Promise<{ txs: WatchTx[] }>;
};

/**
 * Premium tier-3 users get faster credit so they don't have to
 * wait through volatile windows. They've passed enhanced KYC; the
 * tradeoff with brief RBF risk is acceptable for the tier.
 */
export function minConfirmationsForTier(tier: number): number {
  if (tier === 3) return 0;
  if (tier === 2) return 1;
  return 3;
}

export async function pollOnce(rpc: RpcClient): Promise<void> {
  const addresses = await prisma.bitcoinAddress.findMany({
    select: {
      address: true,
      asset: true,
      userId: true,
      user: { select: { kycTier: true } },
    },
  });

  for (const ba of addresses) {
    const { txs } = await rpc.watch(ba.address).catch(() => ({ txs: [] }));
    const minConf = minConfirmationsForTier(ba.user.kycTier);

    for (const tx of txs) {
      await reconcile(ba, tx, minConf);
    }

    // RBF-drop detection: any prior Deposit row with status seen/confirming
    // whose txid is no longer in the watch response gets re-checked.
    const known = await prisma.deposit.findMany({
      where: {
        address: ba.address,
        status: { in: ["seen", "confirming"] },
      },
    });
    for (const d of known) {
      if (!txs.find((t) => t.txid === d.txid && t.vout === d.vout)) {
        // gone from mempool and blocks → RBF-dropped or never existed
        await prisma.deposit.update({
          where: { id: d.id },
          data: { status: "dropped" },
        });
      }
    }
  }
}

async function reconcile(
  ba: { address: string; asset: string; userId: string },
  tx: WatchTx,
  minConf: number,
): Promise<void> {
  const existing = await prisma.deposit.findUnique({
    where: { txid_vout: { txid: tx.txid, vout: tx.vout } },
  });

  if (!existing) {
    await prisma.deposit.create({
      data: {
        userId: ba.userId,
        asset: ba.asset,
        address: ba.address,
        txid: tx.txid,
        vout: tx.vout,
        amount: tx.amountBtc.toFixed(8),
        confirmations: tx.confirmations,
        status: "seen",
      },
    });
  } else {
    await prisma.deposit.update({
      where: { id: existing.id },
      data: { confirmations: tx.confirmations },
    });
  }

  // Credit if confirmations >= tier threshold AND not yet credited.
  const row = await prisma.deposit.findUnique({
    where: { txid_vout: { txid: tx.txid, vout: tx.vout } },
  });
  if (!row) return;
  if (row.status === "credited" || row.status === "dropped") return;
  if (tx.confirmations < minConf) {
    if (row.status === "seen" && tx.confirmations > 0) {
      await prisma.deposit.update({
        where: { id: row.id },
        data: { status: "confirming" },
      });
    }
    return;
  }

  await prisma.$transaction([
    prisma.deposit.update({
      where: { id: row.id },
      data: { status: "credited", creditedAt: new Date() },
    }),
    prisma.balance.upsert({
      where: { userId_asset: { userId: ba.userId, asset: ba.asset } },
      create: {
        userId: ba.userId,
        asset: ba.asset,
        amount: tx.amountBtc.toFixed(8),
      },
      update: {
        amount: { increment: tx.amountBtc.toFixed(8) },
      },
    }),
  ]);
}
