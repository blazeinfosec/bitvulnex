import { describe, it, expect, beforeEach } from "vitest";
import {
  pollOnce,
  type DepositDb,
  type RpcClient,
  type WatchTx,
} from "./deposit-watcher.js";

// Hand-rolled in-memory fake of the subset of Prisma the watcher
// actually uses. The Prisma type surface is very deep (generated
// FieldUpdateOperationsInput unions etc.); to keep the test
// readable we type the fake as `any` internally and cast once at
// the boundary. Runtime shape matches what pollOnce calls.
type AddrRow = {
  address: string;
  asset: string;
  userId: string;
  user: { kycTier: number };
};
type DepositRow = {
  id: string;
  userId: string;
  asset: string;
  address: string;
  txid: string;
  vout: number;
  amount: string;
  confirmations: number;
  status: "seen" | "confirming" | "credited" | "dropped";
  creditedAt: Date | null;
};

function makeFake(seed: { addresses: AddrRow[] }) {
  const deposits: DepositRow[] = [];
  const balances = new Map<
    string,
    { userId: string; asset: string; amount: string }
  >();
  let idSeq = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    bitcoinAddress: {
      findMany: async () => seed.addresses,
    },
    deposit: {
      findMany: async ({
        where,
      }: {
        where: { address: string; status?: { in?: string[] } };
      }) =>
        deposits.filter(
          (d) =>
            d.address === where.address &&
            (where.status?.in ?? [d.status]).includes(d.status),
        ),
      findUnique: async ({
        where,
      }: {
        where: {
          id?: string;
          txid_vout?: { txid: string; vout: number };
        };
      }) => {
        if (where.txid_vout) {
          return (
            deposits.find(
              (d) =>
                d.txid === where.txid_vout!.txid &&
                d.vout === where.txid_vout!.vout,
            ) ?? null
          );
        }
        return deposits.find((d) => d.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Omit<DepositRow, "id" | "creditedAt"> }) => {
        const row: DepositRow = {
          id: `d${++idSeq}`,
          creditedAt: null,
          ...data,
        };
        deposits.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<DepositRow>;
      }) => {
        const idx = deposits.findIndex((d) => d.id === where.id);
        if (idx < 0) throw new Error("not found");
        deposits[idx] = { ...deposits[idx]!, ...data };
        return deposits[idx]!;
      },
    },
    balance: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        create: { userId: string; asset: string; amount: string };
        update: { amount?: { increment?: string } };
      }) => {
        const key = `${where.userId_asset.userId}:${where.userId_asset.asset}`;
        const existing = balances.get(key);
        if (existing) {
          const inc = update.amount?.increment ?? "0";
          existing.amount = (
            Number(existing.amount) + Number(inc)
          ).toFixed(8);
          return existing;
        }
        const row = {
          userId: create.userId,
          asset: create.asset,
          amount: create.amount,
        };
        balances.set(key, row);
        return row;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return { db: db as DepositDb, deposits, balances };
}

function staticRpc(byAddress: Record<string, WatchTx[]>): RpcClient {
  return {
    watch: async (address: string) => ({ txs: byAddress[address] ?? [] }),
  };
}

describe("pollOnce", () => {
  let seed: { addresses: AddrRow[] };
  beforeEach(() => {
    seed = {
      addresses: [
        {
          address: "bcrt1quser_addr",
          asset: "BTC",
          userId: "u1",
          user: { kycTier: 3 },
        },
      ],
    };
  });

  it("credits a deposit once confirmations meet the user's threshold", async () => {
    const { db, deposits, balances } = makeFake(seed);
    const rpc = staticRpc({
      "bcrt1quser_addr": [
        { txid: "a".repeat(64), vout: 0, amountBtc: 0.25, confirmations: 0 },
      ],
    });

    await pollOnce(rpc, db);

    expect(deposits).toHaveLength(1);
    expect(deposits[0]?.status).toBe("credited");
    expect(Number(balances.get("u1:BTC")?.amount)).toBe(0.25);
  });

  it("seen → confirming → credited transitions across polls", async () => {
    seed.addresses[0]!.user.kycTier = 1; // threshold = 3
    const { db, deposits } = makeFake(seed);
    const txid = "b".repeat(64);

    await pollOnce(
      staticRpc({
        "bcrt1quser_addr": [{ txid, vout: 0, amountBtc: 0.1, confirmations: 0 }],
      }),
      db,
    );
    expect(deposits[0]?.status).toBe("seen");

    await pollOnce(
      staticRpc({
        "bcrt1quser_addr": [{ txid, vout: 0, amountBtc: 0.1, confirmations: 1 }],
      }),
      db,
    );
    expect(deposits[0]?.status).toBe("confirming");

    await pollOnce(
      staticRpc({
        "bcrt1quser_addr": [{ txid, vout: 0, amountBtc: 0.1, confirmations: 3 }],
      }),
      db,
    );
    expect(deposits[0]?.status).toBe("credited");
  });

  it("after a credited deposit disappears from the chain watch, the row stays credited and balance is NOT decremented (planted V-42 shape — credit-and-no-reconcile)", async () => {
    const { db, deposits, balances } = makeFake(seed);
    const txid = "c".repeat(64);

    await pollOnce(
      staticRpc({
        "bcrt1quser_addr": [{ txid, vout: 0, amountBtc: 0.5, confirmations: 0 }],
      }),
      db,
    );
    expect(deposits[0]?.status).toBe("credited");
    expect(Number(balances.get("u1:BTC")?.amount)).toBe(0.5);

    await pollOnce(staticRpc({ "bcrt1quser_addr": [] }), db);
    expect(deposits[0]?.status).toBe("credited");
    expect(Number(balances.get("u1:BTC")?.amount)).toBe(0.5);
  });
});
