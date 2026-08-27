-- AlterTable
ALTER TABLE "AssistantKnowledgeImport" ADD COLUMN     "newDocumentEnabledAt" TIMESTAMP(3),
ADD COLUMN     "replacementError" TEXT;
