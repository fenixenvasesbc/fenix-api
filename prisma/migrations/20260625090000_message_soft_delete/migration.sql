ALTER TABLE "Message"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByProviderEventId" TEXT;

CREATE INDEX "Message_accountId_leadId_deletedAt_idx" ON "Message"("accountId", "leadId", "deletedAt");
