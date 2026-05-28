-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('seen', 'confirming', 'credited', 'dropped');

-- CreateTable
CREATE TABLE "bitcoin_addresses" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "asset"           TEXT NOT NULL,
    "address"         TEXT NOT NULL,
    "derivationIndex" INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bitcoin_addresses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bitcoin_addresses_address_key" ON "bitcoin_addresses"("address");
CREATE INDEX "bitcoin_addresses_userId_asset_idx" ON "bitcoin_addresses"("userId", "asset");
ALTER TABLE "bitcoin_addresses" ADD CONSTRAINT "bitcoin_addresses_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- CreateTable
CREATE TABLE "deposits" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "asset"         TEXT NOT NULL,
    "address"       TEXT NOT NULL,
    "txid"          TEXT NOT NULL,
    "vout"          INTEGER NOT NULL,
    "amount"        DECIMAL(38,8) NOT NULL,
    "confirmations" INTEGER NOT NULL,
    "status"        "DepositStatus" NOT NULL DEFAULT 'seen',
    "seenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditedAt"    TIMESTAMP(3),
    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deposits_txid_vout_key" ON "deposits"("txid", "vout");
CREATE INDEX "deposits_userId_idx" ON "deposits"("userId");
CREATE INDEX "deposits_address_idx" ON "deposits"("address");
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- CreateTable
CREATE TABLE "balances" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "asset"     TEXT NOT NULL,
    "amount"    DECIMAL(38,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "balances_userId_asset_key" ON "balances"("userId", "asset");
CREATE INDEX "balances_userId_idx" ON "balances"("userId");
ALTER TABLE "balances" ADD CONSTRAINT "balances_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
