-- Phase 8: admin / compliance / support back-office surfaces.
-- Additive only — no existing columns altered or dropped.

CREATE TYPE "SupportTicketStatus" AS ENUM (
  'open',
  'awaiting_user',
  'awaiting_agent',
  'resolved',
  'closed'
);

CREATE TYPE "SupportTicketCategory" AS ENUM (
  'general',
  'account',
  'deposit',
  'withdrawal',
  'trading',
  'kyc',
  'security'
);

CREATE TYPE "ComplianceCaseStatus" AS ENUM (
  'open',
  'in_review',
  'escalated',
  'resolved',
  'dismissed'
);

CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "SupportTicketCategory" NOT NULL DEFAULT 'general',
  "subject" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_userId_idx" ON "support_tickets"("userId");
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "support_ticket_messages" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "isAgent" BOOLEAN NOT NULL DEFAULT false,
  "bodyMd" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_ticket_messages_ticketId_idx" ON "support_ticket_messages"("ticketId");

ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "compliance_cases" (
  "id" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "openedById" TEXT,
  "status" "ComplianceCaseStatus" NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compliance_cases_subjectUserId_idx" ON "compliance_cases"("subjectUserId");
CREATE INDEX "compliance_cases_status_idx" ON "compliance_cases"("status");

ALTER TABLE "compliance_cases"
  ADD CONSTRAINT "compliance_cases_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compliance_cases"
  ADD CONSTRAINT "compliance_cases_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "admin_audit_logs" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_actorUserId_idx" ON "admin_audit_logs"("actorUserId");
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

ALTER TABLE "admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
