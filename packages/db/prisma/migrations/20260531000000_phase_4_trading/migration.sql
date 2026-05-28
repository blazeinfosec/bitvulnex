-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('buy', 'sell');
CREATE TYPE "OrderType" AS ENUM ('limit', 'market', 'stop_limit', 'oco');
CREATE TYPE "OrderStatus" AS ENUM ('open', 'partial', 'filled', 'cancelled');

-- AlterTable (additive, backfill from existing amount)
ALTER TABLE "balances"
    ADD COLUMN "available" DECIMAL(38,8) NOT NULL DEFAULT 0,
    ADD COLUMN "locked"    DECIMAL(38,8) NOT NULL DEFAULT 0;
UPDATE "balances" SET "available" = "amount";

-- CreateTable
CREATE TABLE "trading_pairs" (
    "id"           TEXT NOT NULL,
    "base"         TEXT NOT NULL,
    "quote"        TEXT NOT NULL,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "minOrderSize" DECIMAL(38,8) NOT NULL,
    "priceTick"    DECIMAL(38,8) NOT NULL,
    CONSTRAINT "trading_pairs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trading_pairs_base_quote_key" ON "trading_pairs"("base", "quote");

-- CreateTable
CREATE TABLE "orders" (
    "id"          SERIAL NOT NULL,
    "userId"      TEXT NOT NULL,
    "pair"        TEXT NOT NULL,
    "side"        "OrderSide" NOT NULL,
    "type"        "OrderType" NOT NULL,
    "price"       DECIMAL(38,8),
    "amount"      DECIMAL(38,8) NOT NULL,
    "filled"      DECIMAL(38,8) NOT NULL DEFAULT 0,
    "status"      "OrderStatus" NOT NULL DEFAULT 'open',
    "stopTrigger" DECIMAL(38,8),
    "ocoPairId"   INTEGER,
    "feeTier"     TEXT NOT NULL DEFAULT 'base',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orders_userId_idx" ON "orders"("userId");
CREATE INDEX "orders_pair_status_idx" ON "orders"("pair", "status");
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- CreateTable
CREATE TABLE "trades" (
    "id"           SERIAL NOT NULL,
    "pair"         TEXT NOT NULL,
    "takerOrderId" INTEGER NOT NULL,
    "makerOrderId" INTEGER NOT NULL,
    "takerUserId"  TEXT NOT NULL,
    "makerUserId"  TEXT NOT NULL,
    "price"        DECIMAL(38,8) NOT NULL,
    "amount"       DECIMAL(38,8) NOT NULL,
    "takerFeeBps"  INTEGER NOT NULL,
    "makerFeeBps"  INTEGER NOT NULL,
    "executedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trades_pair_executedAt_idx" ON "trades"("pair", "executedAt");
CREATE INDEX "trades_takerUserId_idx" ON "trades"("takerUserId");
CREATE INDEX "trades_makerUserId_idx" ON "trades"("makerUserId");
ALTER TABLE "trades" ADD CONSTRAINT "trades_takerOrderId_fkey"
    FOREIGN KEY ("takerOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "trades" ADD CONSTRAINT "trades_makerOrderId_fkey"
    FOREIGN KEY ("makerOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "trades" ADD CONSTRAINT "trades_takerUserId_fkey"
    FOREIGN KEY ("takerUserId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "trades" ADD CONSTRAINT "trades_makerUserId_fkey"
    FOREIGN KEY ("makerUserId") REFERENCES "users"("id") ON DELETE CASCADE;

-- Seed initial pairs (idempotent — uses ON CONFLICT)
INSERT INTO "trading_pairs" ("id", "base", "quote", "active", "minOrderSize", "priceTick") VALUES
    ('tp_btcusdt', 'BTC', 'USDT', true, 0.00010000, 0.01000000),
    ('tp_ethusdt', 'ETH', 'USDT', true, 0.00100000, 0.01000000)
ON CONFLICT ("base", "quote") DO NOTHING;
