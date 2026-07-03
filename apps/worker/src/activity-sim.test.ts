import { describe, it, expect } from "vitest";
import { simulateActivityTick, type ActivitySimDb } from "./activity-sim.js";

// Build a fake DB that records the calls the simulator makes, so we can
// assert its behaviour without standing up Postgres.
function makeFakeDb() {
  const calls = {
    deposits: [] as unknown[],
    balances: [] as unknown[],
    tickets: [] as unknown[],
    messages: [] as unknown[],
    cases: [] as unknown[],
  };
  const db = {
    user: {
      findMany: async () => [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
    },
    deposit: {
      create: async (args: { data: unknown }) => {
        calls.deposits.push(args.data);
        return args.data;
      },
    },
    balance: {
      upsert: async (args: unknown) => {
        calls.balances.push(args);
        return args;
      },
    },
    supportTicket: {
      create: async (args: { data: unknown }) => {
        calls.tickets.push(args.data);
        return { id: "t1" };
      },
    },
    supportTicketMessage: {
      create: async (args: { data: unknown }) => {
        calls.messages.push(args.data);
        return args.data;
      },
    },
    complianceCase: {
      create: async (args: { data: unknown }) => {
        calls.cases.push(args.data);
        return args.data;
      },
    },
    adminAuditLog: { create: async () => ({}) },
    // Array-form $transaction: the create/upsert calls have already
    // executed (the fakes are async and run when invoked), so just
    // settle them together like Prisma's interactive batch.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as ActivitySimDb;
  return { db, calls };
}

describe("simulateActivityTick", () => {
  it("fires every branch when the RNG is always low", async () => {
    const { db, calls } = makeFakeDb();
    const { actions } = await simulateActivityTick(db, () => 0.01, 1_000);
    // deposit (p<0.8) + ticket (p<0.25) + compliance (p<0.08) all fire.
    expect(actions).toContain("deposit:BTC");
    expect(actions).toContain("ticket");
    expect(actions).toContain("compliance-case");
    // A credited deposit always pairs with a balance increment.
    expect(calls.deposits).toHaveLength(1);
    expect(calls.balances).toHaveLength(1);
    expect(calls.tickets).toHaveLength(1);
    expect(calls.messages).toHaveLength(1);
    expect(calls.cases).toHaveLength(1);
  });

  it("does nothing when the RNG is always high", async () => {
    const { db, calls } = makeFakeDb();
    const { actions } = await simulateActivityTick(db, () => 0.99, 1_000);
    expect(actions).toHaveLength(0);
    expect(calls.deposits).toHaveLength(0);
    expect(calls.tickets).toHaveLength(0);
    expect(calls.cases).toHaveLength(0);
  });
});
