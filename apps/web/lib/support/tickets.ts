// Support ticket helpers. Centralized so the user-facing and admin
// routes stay aligned on lifecycle transitions.

import { prisma as defaultPrisma } from "@bvbe/db";
import type { SupportTicketCategory, SupportTicketStatus } from "@bvbe/db";

export type OpenTicketArgs = {
  userId: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
};

export async function openTicket(
  args: OpenTicketArgs,
  db: typeof defaultPrisma = defaultPrisma,
) {
  return db.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId: args.userId,
        category: args.category,
        subject: args.subject,
        status: "awaiting_agent",
      },
    });
    await tx.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: args.userId,
        isAgent: false,
        bodyMd: args.body,
      },
    });
    return ticket;
  });
}

export type ReplyArgs = {
  ticketId: string;
  authorId: string;
  isAgent: boolean;
  body: string;
};

export async function replyToTicket(
  args: ReplyArgs,
  db: typeof defaultPrisma = defaultPrisma,
) {
  return db.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findUnique({
      where: { id: args.ticketId },
    });
    if (!ticket) throw new Error("ticket not found");
    const next: SupportTicketStatus = args.isAgent
      ? "awaiting_user"
      : "awaiting_agent";
    const msg = await tx.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: args.authorId,
        isAgent: args.isAgent,
        bodyMd: args.body,
      },
    });
    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: { status: next },
    });
    return msg;
  });
}

export type ChangeStatusArgs = {
  ticketId: string;
  status: SupportTicketStatus;
  actorId: string;
};

export async function changeStatus(
  args: ChangeStatusArgs,
  db: typeof defaultPrisma = defaultPrisma,
) {
  return db.supportTicket.update({
    where: { id: args.ticketId },
    data: {
      status: args.status,
      closedAt:
        args.status === "closed" || args.status === "resolved"
          ? new Date()
          : null,
    },
  });
}
