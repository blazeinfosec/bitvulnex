-- Phase 7 — withdrawals, daily limit ledger, internal transfers,
-- treasury multi-sig coordinator. Additive only.

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM (
    'pending',
    'approved',
    'broadcasting',
    'broadcast',
    'confirming',
    'confirmed',
    'rejected',
    'bumped',
    'failed'
);

CREATE TYPE "TreasuryDraftStatus" AS ENUM (
    'drafted',
    'partial',
    'signed',
    'broadcast',
    'failed'
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "asset"          TEXT NOT NULL,
    "amount"         DECIMAL(38,8) NOT NULL,
    "fee"            DECIMAL(38,8) NOT NULL,
    "destAddress"    TEXT NOT NULL,
    "status"         "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "txid"           TEXT,
    "replacedByTxid" TEXT,
    "requestedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"     TIMESTAMP(3),
    "broadcastAt"    TIMESTAMP(3),
    "confirmedAt"    TIMESTAMP(3),
    "failedReason"   TEXT,
    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "withdrawals_userId_idx" ON "withdrawals"("userId");
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");
CREATE INDEX "withdrawals_txid_idx" ON "withdrawals"("txid");
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "withdrawal_limit_ledger" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "utcDate"    DATE NOT NULL,
    "asset"      TEXT NOT NULL,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "withdrawal_limit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "withdrawal_limit_ledger_userId_utcDate_asset_key"
    ON "withdrawal_limit_ledger"("userId", "utcDate", "asset");
CREATE INDEX "withdrawal_limit_ledger_userId_utcDate_idx"
    ON "withdrawal_limit_ledger"("userId", "utcDate");
ALTER TABLE "withdrawal_limit_ledger" ADD CONSTRAINT "withdrawal_limit_ledger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "internal_transfers" (
    "id"         TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId"   TEXT NOT NULL,
    "asset"      TEXT NOT NULL,
    "amount"     DECIMAL(38,8) NOT NULL,
    "memo"       TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_transfers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "internal_transfers_fromUserId_idx" ON "internal_transfers"("fromUserId");
CREATE INDEX "internal_transfers_toUserId_idx" ON "internal_transfers"("toUserId");
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "treasury_drafts" (
    "id"              TEXT NOT NULL,
    "authorUserId"    TEXT NOT NULL,
    "psbtBase64"      TEXT NOT NULL,
    "intentNote"      TEXT,
    "intendedOutputs" JSONB NOT NULL,
    "status"          "TreasuryDraftStatus" NOT NULL DEFAULT 'drafted',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "broadcastTxid"   TEXT,
    "broadcastAt"     TIMESTAMP(3),
    CONSTRAINT "treasury_drafts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "treasury_drafts_status_idx" ON "treasury_drafts"("status");
ALTER TABLE "treasury_drafts" ADD CONSTRAINT "treasury_drafts_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT;

CREATE TABLE "treasury_signatures" (
    "id"           TEXT NOT NULL,
    "draftId"      TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_signatures_draftId_signerUserId_key"
    ON "treasury_signatures"("draftId", "signerUserId");
ALTER TABLE "treasury_signatures" ADD CONSTRAINT "treasury_signatures_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "treasury_drafts"("id") ON DELETE CASCADE;
ALTER TABLE "treasury_signatures" ADD CONSTRAINT "treasury_signatures_signerUserId_fkey"
    FOREIGN KEY ("signerUserId") REFERENCES "users"("id") ON DELETE RESTRICT;
