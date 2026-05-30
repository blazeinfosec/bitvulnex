-- Phase 11 — CTF flag and hint subsystem.

-- CreateEnum
CREATE TYPE "HintsOverride" AS ENUM ('follow', 'enable', 'disable');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "cohortId" TEXT,
  ADD COLUMN "hintsOverride" "HintsOverride" NOT NULL DEFAULT 'follow';

-- CreateTable
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "saltFingerprint" TEXT NOT NULL,
    "hintsDefault" BOOLEAN NOT NULL DEFAULT false,
    "verboseUnlockSeconds" INTEGER NOT NULL DEFAULT 900,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cohorts_name_key" ON "cohorts"("name");

-- CreateTable
CREATE TABLE "ctf_submissions" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "flagPrefix" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctf_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ctf_submissions_cohortId_userId_targetKey_valid_key"
  ON "ctf_submissions"("cohortId", "userId", "targetKey", "valid");
CREATE INDEX "ctf_submissions_cohortId_submittedAt_idx"
  ON "ctf_submissions"("cohortId", "submittedAt");

-- CreateTable
CREATE TABLE "ctf_interactions" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctf_interactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ctf_interactions_cohortId_userId_targetKey_key"
  ON "ctf_interactions"("cohortId", "userId", "targetKey");

-- CreateTable
CREATE TABLE "ctf_hint_reveals" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctf_hint_reveals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ctf_hint_reveals_cohortId_userId_targetKey_tier_key"
  ON "ctf_hint_reveals"("cohortId", "userId", "targetKey", "tier");
CREATE INDEX "ctf_hint_reveals_cohortId_idx" ON "ctf_hint_reveals"("cohortId");

-- AddForeignKey
ALTER TABLE "users"
  ADD CONSTRAINT "users_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ctf_submissions"
  ADD CONSTRAINT "ctf_submissions_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ctf_submissions"
  ADD CONSTRAINT "ctf_submissions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ctf_interactions"
  ADD CONSTRAINT "ctf_interactions_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ctf_interactions"
  ADD CONSTRAINT "ctf_interactions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ctf_hint_reveals"
  ADD CONSTRAINT "ctf_hint_reveals_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ctf_hint_reveals"
  ADD CONSTRAINT "ctf_hint_reveals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
