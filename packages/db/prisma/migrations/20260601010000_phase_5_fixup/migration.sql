-- Phase-5 L7 Q-5.1 fix: backfill marginAvailable so existing
-- balance rows can actually back margin positions. New rows get
-- amount = available = marginAvailable on first deposit credit
-- (the deposit watcher's upsert creates with available=amount, and
-- this same migration backfills the rest).
UPDATE "balances" SET "marginAvailable" = "amount" WHERE "marginAvailable" = 0;

-- Phase-5 L7 Q-5.2: keeper-registration flag on users.
ALTER TABLE "users" ADD COLUMN "keeperRegisteredAt" TIMESTAMP(3);
