-- Phase 6 — lending, staking, OTC desk, P2P escrow.
-- Additive only: no column changes to existing tables.

-- CreateEnum
CREATE TYPE "LendingSide" AS ENUM ('supply', 'borrow');
CREATE TYPE "LendingStatus" AS ENUM ('open', 'closed');
CREATE TYPE "StakingStatus" AS ENUM ('active', 'unstaking', 'ended');
CREATE TYPE "OtcStatus" AS ENUM ('requested', 'quoted', 'accepted', 'filled', 'cancelled', 'expired');
CREATE TYPE "P2PStatus" AS ENUM ('open', 'paused', 'filled', 'cancelled');
CREATE TYPE "P2PTradeStatus" AS ENUM ('pending_payment', 'paid', 'released', 'disputed', 'cancelled');

-- CreateTable
CREATE TABLE "lending_pools" (
    "id"           TEXT NOT NULL,
    "asset"        TEXT NOT NULL,
    "supplied"     DECIMAL(38,8) NOT NULL DEFAULT 0,
    "borrowed"     DECIMAL(38,8) NOT NULL DEFAULT 0,
    "reserve"      DECIMAL(38,8) NOT NULL DEFAULT 0,
    "apyBaseBps"   INTEGER NOT NULL,
    "apySlopeBps"  INTEGER NOT NULL,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "lastAccrual"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lending_pools_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lending_pools_asset_key" ON "lending_pools"("asset");

CREATE TABLE "lending_positions" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "pool"            TEXT NOT NULL,
    "side"            "LendingSide" NOT NULL,
    "principal"       DECIMAL(38,8) NOT NULL,
    "accrued"         DECIMAL(38,8) NOT NULL DEFAULT 0,
    "collateralAsset" TEXT,
    "collateral"      DECIMAL(38,8),
    "openedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"        TIMESTAMP(3),
    "status"          "LendingStatus" NOT NULL DEFAULT 'open',
    CONSTRAINT "lending_positions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lending_positions_userId_pool_idx" ON "lending_positions"("userId", "pool");
CREATE INDEX "lending_positions_pool_status_idx" ON "lending_positions"("pool", "status");
ALTER TABLE "lending_positions" ADD CONSTRAINT "lending_positions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "staking_programs" (
    "id"            TEXT NOT NULL,
    "asset"         TEXT NOT NULL,
    "rewardAsset"   TEXT NOT NULL,
    "apyBps"        INTEGER NOT NULL,
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "windowSeconds" INTEGER NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staking_programs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staking_programs_asset_key" ON "staking_programs"("asset");

CREATE TABLE "staking_positions" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "asset"      TEXT NOT NULL,
    "principal"  DECIMAL(38,8) NOT NULL,
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unstakedAt" TIMESTAMP(3),
    "status"     "StakingStatus" NOT NULL DEFAULT 'active',
    CONSTRAINT "staking_positions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staking_positions_userId_idx" ON "staking_positions"("userId");
CREATE INDEX "staking_positions_asset_status_idx" ON "staking_positions"("asset", "status");
ALTER TABLE "staking_positions" ADD CONSTRAINT "staking_positions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "staking_claims" (
    "id"          TEXT NOT NULL,
    "positionId"  TEXT NOT NULL,
    "amount"      DECIMAL(38,8) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd"   TIMESTAMP(3) NOT NULL,
    "claimedAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staking_claims_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staking_claims_positionId_idx" ON "staking_claims"("positionId");
ALTER TABLE "staking_claims" ADD CONSTRAINT "staking_claims_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "staking_positions"("id") ON DELETE CASCADE;

CREATE TABLE "otc_tickets" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "pair"           TEXT NOT NULL,
    "side"           "OrderSide" NOT NULL,
    "amount"         DECIMAL(38,8) NOT NULL,
    "quotedPrice"    DECIMAL(38,8),
    "status"         "OtcStatus" NOT NULL DEFAULT 'quoted',
    "quoteExpiresAt" TIMESTAMP(3),
    "filledAt"       TIMESTAMP(3),
    "feeBps"         INTEGER,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "otc_tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "otc_tickets_userId_idx" ON "otc_tickets"("userId");
CREATE INDEX "otc_tickets_status_idx" ON "otc_tickets"("status");
ALTER TABLE "otc_tickets" ADD CONSTRAINT "otc_tickets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "p2p_offers" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "side"      "OrderSide" NOT NULL,
    "asset"     TEXT NOT NULL,
    "amount"    DECIMAL(38,8) NOT NULL,
    "price"     DECIMAL(38,8) NOT NULL,
    "payMethod" TEXT NOT NULL,
    "status"    "P2PStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "p2p_offers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "p2p_offers_asset_status_idx" ON "p2p_offers"("asset", "status");
ALTER TABLE "p2p_offers" ADD CONSTRAINT "p2p_offers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "p2p_trades" (
    "id"           TEXT NOT NULL,
    "offerId"      TEXT NOT NULL,
    "buyerUserId"  TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "amount"       DECIMAL(38,8) NOT NULL,
    "price"        DECIMAL(38,8) NOT NULL,
    "asset"        TEXT NOT NULL,
    "status"       "P2PTradeStatus" NOT NULL DEFAULT 'pending_payment',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt"   TIMESTAMP(3),
    "disputedAt"   TIMESTAMP(3),
    CONSTRAINT "p2p_trades_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "p2p_trades_buyerUserId_idx" ON "p2p_trades"("buyerUserId");
CREATE INDEX "p2p_trades_sellerUserId_idx" ON "p2p_trades"("sellerUserId");
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "p2p_offers"("id") ON DELETE RESTRICT;
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_buyerUserId_fkey"
    FOREIGN KEY ("buyerUserId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_sellerUserId_fkey"
    FOREIGN KEY ("sellerUserId") REFERENCES "users"("id") ON DELETE CASCADE;

-- Seed lending pools (BTC, USDT, ETH) and staking programs (ETH, LTC).
INSERT INTO "lending_pools" ("id", "asset", "apyBaseBps", "apySlopeBps", "updatedAt") VALUES
    ('pool_btc',  'BTC',  200, 1000, CURRENT_TIMESTAMP),
    ('pool_usdt', 'USDT', 200, 1000, CURRENT_TIMESTAMP),
    ('pool_eth',  'ETH',  200, 1000, CURRENT_TIMESTAMP);

INSERT INTO "staking_programs" ("id", "asset", "rewardAsset", "apyBps", "windowSeconds") VALUES
    ('stk_eth', 'ETH', 'ETH', 400, 3600),
    ('stk_ltc', 'LTC', 'LTC', 300, 3600);
