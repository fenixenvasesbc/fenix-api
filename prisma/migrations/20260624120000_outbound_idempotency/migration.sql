ALTER TABLE "Message"
ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Message_accountId_clientRequestId_key"
ON "Message"("accountId", "clientRequestId");
