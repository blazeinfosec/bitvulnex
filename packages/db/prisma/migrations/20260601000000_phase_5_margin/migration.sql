-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('long', 'short');
CREATE TYPE "PositionStatus" AS ENUM ('open', 'liquidated', 'closed');

-- AlterTable (additive)
ALTER TABLE "balances"
    ADD COLUMN "marginAvailable" DECIMAL(38,8) NOT NULL DEFAULT 0,
    ADD COLUMN "marginBorrowed"  DECIMAL(38,8) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "margin_positions" (
    "id"               SERIAL NOT NULL,
    "userId"           TEXT NOT NULL,
    "pair"             TEXT NOT NULL,
    "side"             "PositionSide" NOT NULL,
    "size"             DECIMAL(38,8) NOT NULL,
    "entryPrice"       DECIMAL(38,8) NOT NULL,
    "leverage"         INTEGER NOT NULL,
    "collateralAsset"  TEXT NOT NULL,
    "collateral"       DECIMAL(38,8) NOT NULL,
    "liquidationPrice" DECIMAL(38,8) NOT NULL,
    "status"           "PositionStatus" NOT NULL DEFAULT 'open',
    "openedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"         TIMESTAMP(3),
    "closedPrice"      DECIMAL(38,8),
    "realizedPnl"      DECIMAL(38,8),
    CONSTRAINT "margin_positions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "margin_positions_userId_idx" ON "margin_positions"("userId");
CREATE INDEX "margin_positions_pair_status_idx" ON "margin_positions"("pair", "status");
ALTER TABLE "margin_positions" ADD CONSTRAINT "margin_positions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- CreateTable
CREATE TABLE "liquidations" (
    "id"             SERIAL NOT NULL,
    "positionId"     INTEGER NOT NULL,
    "triggerPrice"   DECIMAL(38,8) NOT NULL,
    "keeperUserId"   TEXT,
    "keeperRebate"   DECIMAL(38,8) NOT NULL,
    "flaggedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt"      TIMESTAMP(3),
    CONSTRAINT "liquidations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "liquidations_positionId_key" ON "liquidations"("positionId");
CREATE INDEX "liquidations_keeperUserId_idx" ON "liquidations"("keeperUserId");
ALTER TABLE "liquidations" ADD CONSTRAINT "liquidations_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "margin_positions"("id") ON DELETE CASCADE;
ALTER TABLE "liquidations" ADD CONSTRAINT "liquidations_keeperUserId_fkey"
    FOREIGN KEY ("keeperUserId") REFERENCES "users"("id") ON DELETE SET NULL;
