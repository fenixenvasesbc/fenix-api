/*
  Warnings:

  - Added the required column `updatedAt` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "sourceTemplateName" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "campaignKey" TEXT,
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "errors" JSONB,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "interactivePayload" JSONB,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "responseToId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "accountId" TEXT,
    "leadId" TEXT,
    "messageId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "apiVersion" TEXT,
    "providerTime" TIMESTAMP(3),
    "routingKey" TEXT,
    "queueName" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageStatusHistory" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromStatus" "MessageStatus",
    "toStatus" "MessageStatus" NOT NULL,
    "providerEventId" TEXT,
    "providerTime" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key" ON "WebhookEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_createdAt_idx" ON "WebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_createdAt_idx" ON "WebhookEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_leadId_createdAt_idx" ON "WebhookEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageStatusHistory_messageId_toStatus_createdAt_idx" ON "MessageStatusHistory"("messageId", "toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "MessageStatusHistory_messageId_createdAt_idx" ON "MessageStatusHistory"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageStatusHistory_providerEventId_idx" ON "MessageStatusHistory"("providerEventId");

-- CreateIndex
CREATE INDEX "Lead_accountId_status_createdAt_idx" ON "Lead"("accountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_accountId_lastInboundAt_idx" ON "Lead"("accountId", "lastInboundAt");

-- CreateIndex
CREATE INDEX "Lead_accountId_lastOutboundAt_idx" ON "Lead"("accountId", "lastOutboundAt");

-- CreateIndex
CREATE INDEX "Message_accountId_externalId_idx" ON "Message"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "Message_accountId_wamid_idx" ON "Message"("accountId", "wamid");

-- CreateIndex
CREATE INDEX "Message_leadId_createdAt_idx" ON "Message"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_templateName_createdAt_idx" ON "Message"("templateName", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_responseToId_fkey" FOREIGN KEY ("responseToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageStatusHistory" ADD CONSTRAINT "MessageStatusHistory_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
