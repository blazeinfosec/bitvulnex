import { describe, it, expect } from "vitest";
import { openTicket, replyToTicket, changeStatus } from "./tickets";

type Ticket = {
  id: string;
  userId: string;
  subject: string;
  category: string;
  status: string;
  closedAt: Date | null;
};
type Message = {
  id: string;
  ticketId: string;
  authorId: string;
  isAgent: boolean;
  bodyMd: string;
};

function makeFake() {
  const tickets: Ticket[] = [];
  const messages: Message[] = [];
  let nextT = 1;
  let nextM = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    supportTicket: {
      create: async ({ data }: { data: Omit<Ticket, "id" | "closedAt"> }) => {
        const t: Ticket = { id: `t_${nextT++}`, closedAt: null, ...data };
        tickets.push(t);
        return t;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        tickets.find((t) => t.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Ticket>;
      }) => {
        const t = tickets.find((x) => x.id === where.id);
        if (!t) throw new Error("nope");
        Object.assign(t, data);
        return t;
      },
    },
    supportTicketMessage: {
      create: async ({ data }: { data: Omit<Message, "id"> }) => {
        const m: Message = { id: `m_${nextM++}`, ...data };
        messages.push(m);
        return m;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, tickets, messages };
}

describe("support tickets lib", () => {
  it("openTicket persists ticket + first message", async () => {
    const { db, tickets, messages } = makeFake();
    const t = await openTicket(
      {
        userId: "u1",
        category: "general",
        subject: "hi",
        body: "first message",
      },
      db,
    );
    expect(t.id).toMatch(/^t_/);
    expect(tickets).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.bodyMd).toBe("first message");
  });

  it("replyToTicket flips status to awaiting_agent on user reply", async () => {
    const { db, tickets } = makeFake();
    const t = await openTicket(
      {
        userId: "u1",
        category: "general",
        subject: "hi",
        body: "first",
      },
      db,
    );
    // Simulate agent replied → awaiting_user → user replies → awaiting_agent
    tickets[0]!.status = "awaiting_user";
    await replyToTicket(
      { ticketId: t.id, authorId: "u1", isAgent: false, body: "thanks" },
      db,
    );
    expect(tickets[0]!.status).toBe("awaiting_agent");
  });

  it("changeStatus to closed sets closedAt", async () => {
    const { db, tickets } = makeFake();
    const t = await openTicket(
      {
        userId: "u1",
        category: "general",
        subject: "hi",
        body: "first",
      },
      db,
    );
    await changeStatus({ ticketId: t.id, status: "closed", actorId: "u1" }, db);
    expect(tickets[0]!.status).toBe("closed");
    expect(tickets[0]!.closedAt).toBeInstanceOf(Date);
  });
});
