-- CreateIndex
CREATE INDEX "Lead_accountId_firstOutboundAt_idx" ON "Lead"("accountId", "firstOutboundAt");

-- CreateIndex
CREATE INDEX "Lead_firstOutboundTemplateName_idx" ON "Lead"("firstOutboundTemplateName");
