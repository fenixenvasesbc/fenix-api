-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('YCLOUD');

-- CreateTable
CREATE TABLE "AccountProviderCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiKeyHint" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountProviderCredential_provider_isActive_idx" ON "AccountProviderCredential"("provider", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccountProviderCredential_accountId_provider_key" ON "AccountProviderCredential"("accountId", "provider");

-- AddForeignKey
ALTER TABLE "AccountProviderCredential" ADD CONSTRAINT "AccountProviderCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
