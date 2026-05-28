-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('incomplete', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('passport', 'id_card', 'address_proof');

-- CreateEnum
CREATE TYPE "KycDocSource" AS ENUM ('upload', 'url_import');

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "legalName"       TEXT,
    "dateOfBirth"     TIMESTAMP(3),
    "country"         TEXT,
    "addressLine"     TEXT,
    "city"            TEXT,
    "postalCode"      TEXT,
    "status"          "KycStatus" NOT NULL DEFAULT 'incomplete',
    "submittedAt"     TIMESTAMP(3),
    "reviewedAt"      TIMESTAMP(3),
    "reviewedById"    TEXT,
    "rejectionReason" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kyc_profiles_userId_key" ON "kyc_profiles"("userId");
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "type"       "KycDocType" NOT NULL,
    "filename"   TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType"   TEXT NOT NULL,
    "size"       INTEGER NOT NULL,
    "source"     "KycDocSource" NOT NULL DEFAULT 'upload',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kyc_documents_userId_idx" ON "kyc_documents"("userId");
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
