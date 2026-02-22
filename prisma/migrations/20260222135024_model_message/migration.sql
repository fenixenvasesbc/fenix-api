/*
  Warnings:

  - A unique constraint covering the columns `[accountId,phoneE164]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'RESPONDED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEMPLATE', 'TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "firstInboundAt" TIMESTAMP(3),
ADD COLUMN     "firstOutboundAt" TIMESTAMP(3),
ADD COLUMN     "status" "LeadStatus" NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL,
    "ycloudMessageId" TEXT,
    "wamid" TEXT,
    "contextWamid" TEXT,
    "templateName" TEXT,
    "templateLang" TEXT,
    "pricingCategory" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'UNKNOWN',
    "providerCreateTime" TIMESTAMP(3),
    "providerUpdateTime" TIMESTAMP(3),
    "providerSendTime" TIMESTAMP(3),
    "textBody" TEXT,
    "mediaUrl" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_accountId_leadId_direction_createdAt_idx" ON "Message"("accountId", "leadId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "Message_templateName_idx" ON "Message"("templateName");

-- CreateIndex
CREATE INDEX "Message_wamid_idx" ON "Message"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "Message_accountId_ycloudMessageId_key" ON "Message"("accountId", "ycloudMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_accountId_phoneE164_key" ON "Lead"("accountId", "phoneE164");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
