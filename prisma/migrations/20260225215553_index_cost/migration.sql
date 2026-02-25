-- CreateIndex
CREATE INDEX "Message_accountId_direction_type_providerCreateTime_idx" ON "Message"("accountId", "direction", "type", "providerCreateTime");

-- CreateIndex
CREATE INDEX "Message_accountId_templateName_providerCreateTime_idx" ON "Message"("accountId", "templateName", "providerCreateTime");
