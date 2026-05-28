import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type {
  User,
  SupportTicketStatus,
  SupportTicketCategory,
  ComplianceCaseStatus,
} from "@prisma/client";
// Re-export the `Prisma` namespace so consumers can use
// `Prisma.Decimal`, `Prisma.TransactionClient`, etc. without each
// app adding `@prisma/client` as a direct dependency.
export { Prisma } from "@prisma/client";
