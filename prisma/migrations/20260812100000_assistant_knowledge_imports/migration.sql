-- AlterEnum
ALTER TYPE "AssistantAuditAction" ADD VALUE 'KNOWLEDGE_PROCESS';
ALTER TYPE "AssistantAuditAction" ADD VALUE 'KNOWLEDGE_APPROVE';
ALTER TYPE "AssistantAuditAction" ADD VALUE 'KNOWLEDGE_DISCARD';

-- CreateEnum
CREATE TYPE "AssistantKnowledgeImportStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'DISCARDED', 'NEEDS_MANUAL_REVIEW', 'FAILED');

-- CreateTable
CREATE TABLE "AssistantKnowledgeImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "datasetId" TEXT NOT NULL,
    "datasetName" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceMimeType" TEXT NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "validationPoints" JSONB NOT NULL,
    "status" "AssistantKnowledgeImportStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "difyDocumentId" TEXT,
    "difyBatch" TEXT,
    "difyResponse" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantKnowledgeImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantKnowledgeImport_userId_idx" ON "AssistantKnowledgeImport"("userId");

-- CreateIndex
CREATE INDEX "AssistantKnowledgeImport_accountId_idx" ON "AssistantKnowledgeImport"("accountId");

-- CreateIndex
CREATE INDEX "AssistantKnowledgeImport_datasetId_idx" ON "AssistantKnowledgeImport"("datasetId");

-- CreateIndex
CREATE INDEX "AssistantKnowledgeImport_status_idx" ON "AssistantKnowledgeImport"("status");

-- CreateIndex
CREATE INDEX "AssistantKnowledgeImport_createdAt_idx" ON "AssistantKnowledgeImport"("createdAt");

-- AddForeignKey
ALTER TABLE "AssistantKnowledgeImport" ADD CONSTRAINT "AssistantKnowledgeImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantKnowledgeImport" ADD CONSTRAINT "AssistantKnowledgeImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
