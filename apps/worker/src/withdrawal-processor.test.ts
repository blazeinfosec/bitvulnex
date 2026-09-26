import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  type BitcoinClient,
  type WithdrawalDb,
  processWithdrawalOnce,
} from "./withdrawal-processor.js";

type WRow = {
  id: string;
  userId: string;
  asset: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  destAddress: string;
  status:
    | "pending"
    | "approved"
    | "broadcasting"
    | "broadcast"
    | "confirming"
    | "confirmed"
    | "rejected"
    | "bumped"
    | "failed";
  txid: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  broadcastAt: Date | null;
  confirmedAt: Date | null;
  failedReason: string | null;
};

function makeFakeDb(seed: WRow[]) {
  const rows = [...seed];
  const balances = new Map<string, Prisma.Decimal>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    withdrawal: {
      findMany: async ({
        where,
      }: {
        where: { status: WRow["status"] | { in: WRow["status"][] } };
      }) => {
        const status = where.status;
        return rows.filter((r) =>
          typeof status === "object"
            ? status.in.includes(r.status)
            : r.status === status,
        );
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<WRow>;
      }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("not found");
        rows[idx] = { ...rows[idx]!, ...data };
        return rows[idx];
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: WRow["status"] };
        data: Partial<WRow>;
      }) => {
        const idx = rows.findIndex(
          (r) => r.id === where.id && r.status === where.status,
        );
        if (idx < 0) return { count: 0 };
        rows[idx] = { ...rows[idx]!, ...data };
        return { count: 1 };
      },
    },
    balance: {
      update: async ({
        where,
        data,
      }: {
        where: { userId_asset: { userId: string; asset: string } };
        data: { available: { increment: Prisma.Decimal } };
      }) => {
        const key = `${where.userId_asset.userId}:${where.userId_asset.asset}`;
        const next = (balances.get(key) ?? new Prisma.Decimal(0)).add(
          data.available.increment,
        );
        balances.set(key, next);
        return { available: next };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(api),
  };
  return { db: api as WithdrawalDb, rows, balances };
}

function makeClient(opts: {
  sendmanyImpl?: BitcoinClient["sendmany"];
  txConfirmations?: Record<string, number>;
}): BitcoinClient {
  return {
    sendmany:
      opts.sendmanyImpl ??
      (async () => "deadbeef".padEnd(64, "0")),
    gettransaction: async (txid: string) => ({
      confirmations: opts.txConfirmations?.[txid] ?? 0,
    }),
  };
}

function seedRow(overrides: Partial<WRow> = {}): WRow {
  return {
    id: "w1",
    userId: "u1",
    asset: "BTC",
    amount: new Prisma.Decimal("0.1"),
    fee: new Prisma.Decimal("0.0001"),
    destAddress: "bcrt1qrecipient",
    status: "pending",
    txid: null,
    requestedAt: new Date(),
    approvedAt: null,
    broadcastAt: null,
    confirmedAt: null,
    failedReason: null,
    ...overrides,
  };
}

describe("processWithdrawalOnce", () => {
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb([seedRow()]);
  });

  it("advances pending → broadcast → confirmed across two ticks", async () => {
    const txid = "abc".padEnd(64, "0");
    const client1 = makeClient({
      sendmanyImpl: async () => txid,
      txConfirmations: {},
    });
    let summary = await processWithdrawalOnce(client1, fake.db);
    expect(summary.broadcast).toBe(1);
    expect(fake.rows[0]?.status).toBe("broadcast");
    expect(fake.rows[0]?.txid).toBe(txid);

    const client2 = makeClient({
      sendmanyImpl: async () => "x".repeat(64),
      txConfirmations: { [txid]: 1 },
    });
    summary = await processWithdrawalOnce(client2, fake.db);
    expect(summary.confirmed).toBe(1);
    expect(fake.rows[0]?.status).toBe("confirmed");
  });

  it("is idempotent — re-running after a broadcast does not re-broadcast", async () => {
    const txid = "f".repeat(64);
    fake.rows[0] = seedRow({ status: "broadcast", txid, broadcastAt: new Date() });

    let callCount = 0;
    const client = makeClient({
      sendmanyImpl: async () => {
        callCount += 1;
        return "should-not-be-called";
      },
      txConfirmations: { [txid]: 0 },
    });
    const summary = await processWithdrawalOnce(client, fake.db);
    expect(callCount).toBe(0);
    expect(summary.broadcast).toBe(0);
  });

  it("marks a withdrawal failed when sendmany throws", async () => {
    const client = makeClient({
      sendmanyImpl: async () => {
        throw new Error("rpc unavailable");
      },
    });
    const summary = await processWithdrawalOnce(client, fake.db);
    expect(summary.failed).toBe(1);
    expect(fake.rows[0]?.status).toBe("failed");
    expect(fake.rows[0]?.failedReason).toContain("rpc unavailable");
    // amount + fee is credited back to the user.
    expect(fake.balances.get("u1:BTC")?.toString()).toBe("0.1001");
  });

  it("does not refund a failed send that was cancelled concurrently", async () => {
    const client = makeClient({
      sendmanyImpl: async () => {
        // User cancel lands while the RPC is in flight.
        fake.rows[0] = { ...fake.rows[0]!, status: "rejected" };
        throw new Error("rpc unavailable");
      },
    });
    await processWithdrawalOnce(client, fake.db);
    expect(fake.rows[0]?.status).toBe("rejected");
    expect(fake.balances.get("u1:BTC")).toBeUndefined();
  });

  it("settles non-BTC withdrawals without calling the BTC node", async () => {
    fake.rows[0] = seedRow({ asset: "USDT", amount: new Prisma.Decimal("500") });
    let callCount = 0;
    const client = makeClient({
      sendmanyImpl: async () => {
        callCount += 1;
        return "x".repeat(64);
      },
    });
    const summary = await processWithdrawalOnce(client, fake.db);
    expect(callCount).toBe(0);
    expect(summary.confirmed).toBe(1);
    expect(fake.rows[0]?.status).toBe("confirmed");
  });

  it("confirms a bumped withdrawal once its replacement confirms", async () => {
    const txid = "b".repeat(64);
    fake.rows[0] = seedRow({ status: "bumped", txid });
    const client = makeClient({ txConfirmations: { [txid]: 1 } });
    const summary = await processWithdrawalOnce(client, fake.db);
    expect(summary.confirmed).toBe(1);
    expect(fake.rows[0]?.status).toBe("confirmed");
  });
});
