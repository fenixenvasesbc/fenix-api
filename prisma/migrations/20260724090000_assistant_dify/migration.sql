-- CreateEnum
CREATE TYPE "AssistantSessionMode" AS ENUM ('INTERNAL_FAQ');

-- CreateEnum
CREATE TYPE "AssistantMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AssistantMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssistantFeedbackRating" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- CreateEnum
CREATE TYPE "AssistantAuditAction" AS ENUM ('QUERY', 'FEEDBACK', 'KNOWLEDGE_UPLOAD', 'KNOWLEDGE_LIST');

-- CreateTable
CREATE TABLE "AssistantSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "leadId" TEXT,
    "mode" "AssistantSessionMode" NOT NULL DEFAULT 'INTERNAL_FAQ',
    "title" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'DIFY',
    "providerConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "AssistantMessageRole" NOT NULL,
    "status" "AssistantMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "content" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerTaskId" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "usage" JSONB,
    "rawPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCitation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "providerResourceId" TEXT,
    "datasetId" TEXT,
    "documentId" TEXT,
    "documentName" TEXT,
    "segmentId" TEXT,
    "score" DECIMAL(10,6),
    "excerpt" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" "AssistantFeedbackRating" NOT NULL,
    "reason" TEXT,
    "editedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "action" "AssistantAuditAction" NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "provider" TEXT DEFAULT 'DIFY',
    "providerId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantSession_userId_createdAt_idx" ON "AssistantSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantSession_accountId_createdAt_idx" ON "AssistantSession"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantSession_leadId_createdAt_idx" ON "AssistantSession"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantSession_providerConversationId_idx" ON "AssistantSession"("providerConversationId");

-- CreateIndex
CREATE INDEX "AssistantMessage_sessionId_createdAt_idx" ON "AssistantMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_userId_createdAt_idx" ON "AssistantMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_providerMessageId_idx" ON "AssistantMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "AssistantCitation_messageId_idx" ON "AssistantCitation"("messageId");

-- CreateIndex
CREATE INDEX "AssistantCitation_datasetId_documentId_idx" ON "AssistantCitation"("datasetId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantFeedback_messageId_userId_key" ON "AssistantFeedback"("messageId", "userId");

-- CreateIndex
CREATE INDEX "AssistantFeedback_userId_createdAt_idx" ON "AssistantFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAuditEvent_userId_action_createdAt_idx" ON "AssistantAuditEvent"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAuditEvent_accountId_action_createdAt_idx" ON "AssistantAuditEvent"("accountId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAuditEvent_success_createdAt_idx" ON "AssistantAuditEvent"("success", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantSession" ADD CONSTRAINT "AssistantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantSession" ADD CONSTRAINT "AssistantSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantSession" ADD CONSTRAINT "AssistantSession_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCitation" ADD CONSTRAINT "AssistantCitation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantFeedback" ADD CONSTRAINT "AssistantFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantFeedback" ADD CONSTRAINT "AssistantFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAuditEvent" ADD CONSTRAINT "AssistantAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAuditEvent" ADD CONSTRAINT "AssistantAuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
