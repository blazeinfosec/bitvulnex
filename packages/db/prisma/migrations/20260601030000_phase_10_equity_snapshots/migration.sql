-- Phase 10 slice 5: daily USD-equivalent equity snapshots. The worker
-- (apps/worker/src/equity-snapshot.ts) upserts one row per user per UTC
-- date and the dashboard reads the last 30 days to draw the equity
-- curve.
--
-- Additive only — no destructive ALTER, no DROP.

CREATE TABLE "equity_snapshots" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "date"       DATE NOT NULL,
    "totalUsd"   DECIMAL(38,8) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "equity_snapshots_userId_date_key"
    ON "equity_snapshots" ("userId", "date");

CREATE INDEX "equity_snapshots_userId_date_idx"
    ON "equity_snapshots" ("userId", "date");

ALTER TABLE "equity_snapshots"
    ADD CONSTRAINT "equity_snapshots_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
