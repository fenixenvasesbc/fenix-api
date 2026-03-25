/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `LeadCampaign` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "LeadCampaignStatus" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "LeadCampaign" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LeadCampaign_externalId_key" ON "LeadCampaign"("externalId");

-- CreateIndex
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");
