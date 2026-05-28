import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodePsbt, addSignature } from "@bvbe/shared";

// We test the broadcast path against a hand-rolled in-memory Prisma
// fake so the test stays self-contained. The mock RPC is stubbed
// via vi.mock so we don't reach for a real bitcoind.

vi.mock("../btc-rpc-client", () => ({
  rpc: vi.fn(async (method: string, params: unknown[]) => {
    if (method === "walletprocesspsbt") {
      const psbt = params[0] as string;
      return { psbt: addSignature(psbt), complete: false };
    }
    if (method === "finalizepsbt") {
      const psbt = params[0] as string;
      // Mirror the mock: take the last envelope segment, parse,
      // emit a RAWTX hex.
      const segs = psbt.split("BVBE_PSBT_V1:");
      const last = segs[segs.length - 1] as string;
      const payload = JSON.parse(last) as { outputs: unknown };
      return { hex: "RAWTX:" + JSON.stringify(payload.outputs) };
    }
    if (method === "sendrawtransaction") {
      return "abcdef".padEnd(64, "0");
    }
    throw new Error(`unexpected rpc ${method}`);
  }),
}));

import {
  broadcastDraft,
  createDraft,
  signDraft,
} from "./coordinator";

type Draft = {
  id: string;
  authorUserId: string;
  psbtBase64: string;
  intentNote: string | null;
  intendedOutputs: unknown;
  status: "drafted" | "partial" | "signed" | "broadcast" | "failed";
  broadcastTxid: string | null;
  broadcastAt: Date | null;
};

type Sig = { id: string; draftId: string; signerUserId: string };

function makeFakeDb() {
  const drafts = new Map<string, Draft>();
  const sigs: Sig[] = [];
  let nextId = 0;
  const id = () => `id_${++nextId}`;

  const draftApi = {
    create: async ({ data }: { data: Omit<Draft, "id" | "broadcastTxid" | "broadcastAt"> }) => {
      const row: Draft = {
        id: id(),
        broadcastTxid: null,
        broadcastAt: null,
        ...data,
      };
      drafts.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      drafts.get(where.id) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Draft>;
    }) => {
      const cur = drafts.get(where.id);
      if (!cur) throw new Error("draft not found");
      const next = { ...cur, ...data };
      drafts.set(cur.id, next);
      return next;
    },
  };

  const sigApi = {
    create: async ({ data }: { data: Omit<Sig, "id"> }) => {
      const row = { id: id(), ...data };
      sigs.push(row);
      return row;
    },
    count: async ({ where }: { where: { draftId: string } }) =>
      sigs.filter((s) => s.draftId === where.draftId).length,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    treasuryDraft: draftApi,
    treasurySignature: sigApi,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> =>
      fn(db),
  };
  return { db, drafts, sigs };
}

describe("treasury coordinator", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("createDraft persists an unsigned PSBT with intended outputs", async () => {
    const { db } = makeFakeDb();
    const draft = await createDraft(
      {
        authorUserId: "u_treasury",
        intendedOutputs: [{ address: "bcrt1qhotwallet", amountSat: 5_000_000 }],
        intentNote: "cold→hot top-up",
      },
      db,
    );
    expect(draft.status).toBe("drafted");
    expect(draft.psbtBase64.startsWith("BVBE_PSBT_V1:")).toBe(true);
  });

  it("collects two signatures then broadcasts", async () => {
    const { db } = makeFakeDb();
    const draft = await createDraft(
      {
        authorUserId: "u_treasury1",
        intendedOutputs: [{ address: "bcrt1qhotwallet", amountSat: 5_000_000 }],
      },
      db,
    );
    const partial = await signDraft(
      { draftId: draft.id, signerUserId: "u_treasury1" },
      db,
    );
    expect(partial.status).toBe("partial");

    const signed = await signDraft(
      { draftId: draft.id, signerUserId: "u_treasury2" },
      db,
    );
    expect(signed.status).toBe("signed");

    const broadcast = await broadcastDraft(
      { draftId: draft.id, broadcasterUserId: "u_treasury1" },
      db,
    );
    expect(broadcast.status).toBe("broadcast");
    expect(broadcast.broadcastTxid).toBeTruthy();
  });

  it("rejects broadcast when intended outputs do not match", async () => {
    const { db } = makeFakeDb();
    const draft = await createDraft(
      {
        authorUserId: "u_treasury1",
        intendedOutputs: [{ address: "bcrt1qhotwallet", amountSat: 5_000_000 }],
      },
      db,
    );
    await signDraft({ draftId: draft.id, signerUserId: "u_treasury1" }, db);
    await signDraft({ draftId: draft.id, signerUserId: "u_treasury2" }, db);

    // Tamper the stored PSBT to refer to a different address.
    const tampered = encodePsbt({
      inputs: [],
      outputs: [{ address: "bcrt1qsomewhere_else", amountSat: 5_000_000 }],
      signatures: 2,
      fee: 1_000,
    });
    await expect(
      broadcastDraft(
        {
          draftId: draft.id,
          broadcasterUserId: "u_treasury1",
          overridePsbt: tampered,
        },
        db,
      ),
    ).rejects.toThrow(/address mismatch/);
  });
});
