-- CreateEnum
CREATE TYPE "CampaignDefinitionType" AS ENUM ('FIRST_CONTACT', 'WEEK1_REENGAGEMENT');

-- CreateEnum
CREATE TYPE "CampaignDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountCampaignTemplateStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "LeadCampaignType" AS ENUM ('WEEK1_REENGAGEMENT');

-- CreateEnum
CREATE TYPE "LeadCampaignStatus" AS ENUM ('PENDING', 'ENQUEUED', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "reengagementSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CampaignDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignDefinitionType" NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CampaignDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCampaignTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignDefinitionId" TEXT NOT NULL,
    "officialTemplateId" TEXT,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "qualityRating" TEXT,
    "status" "AccountCampaignTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "statusDetail" TEXT,
    "ycloudCreateTime" TIMESTAMP(3),
    "ycloudUpdateTime" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "payloadSnapshot" JSONB,
    "lastWebhookPayload" JSONB,
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCampaignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCampaign" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LeadCampaignType" NOT NULL,
    "status" "LeadCampaignStatus" NOT NULL DEFAULT 'PENDING',
    "businessWindowKey" TEXT NOT NULL,
    "sourceTemplateName" TEXT,
    "targetTemplateName" TEXT,
    "accountCampaignTemplateId" TEXT,
    "messageId" TEXT,
    "skipReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "enqueuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDefinition_key_key" ON "CampaignDefinition"("key");

-- CreateIndex
CREATE INDEX "CampaignDefinition_type_language_idx" ON "CampaignDefinition"("type", "language");

-- CreateIndex
CREATE INDEX "CampaignDefinition_status_isActive_idx" ON "CampaignDefinition"("status", "isActive");

-- CreateIndex
CREATE INDEX "AccountCampaignTemplate_accountId_status_idx" ON "AccountCampaignTemplate"("accountId", "status");

-- CreateIndex
CREATE INDEX "AccountCampaignTemplate_campaignDefinitionId_status_idx" ON "AccountCampaignTemplate"("campaignDefinitionId", "status");

-- CreateIndex
CREATE INDEX "AccountCampaignTemplate_wabaId_idx" ON "AccountCampaignTemplate"("wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCampaignTemplate_accountId_campaignDefinitionId_key" ON "AccountCampaignTemplate"("accountId", "campaignDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCampaignTemplate_accountId_officialTemplateId_key" ON "AccountCampaignTemplate"("accountId", "officialTemplateId");

-- CreateIndex
CREATE INDEX "LeadCampaign_accountId_type_status_createdAt_idx" ON "LeadCampaign"("accountId", "type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCampaign_accountCampaignTemplateId_idx" ON "LeadCampaign"("accountCampaignTemplateId");

-- CreateIndex
CREATE INDEX "LeadCampaign_messageId_idx" ON "LeadCampaign"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCampaign_leadId_type_businessWindowKey_key" ON "LeadCampaign"("leadId", "type", "businessWindowKey");

-- AddForeignKey
ALTER TABLE "AccountCampaignTemplate" ADD CONSTRAINT "AccountCampaignTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCampaignTemplate" ADD CONSTRAINT "AccountCampaignTemplate_campaignDefinitionId_fkey" FOREIGN KEY ("campaignDefinitionId") REFERENCES "CampaignDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCampaign" ADD CONSTRAINT "LeadCampaign_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCampaign" ADD CONSTRAINT "LeadCampaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCampaign" ADD CONSTRAINT "LeadCampaign_accountCampaignTemplateId_fkey" FOREIGN KEY ("accountCampaignTemplateId") REFERENCES "AccountCampaignTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCampaign" ADD CONSTRAINT "LeadCampaign_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
