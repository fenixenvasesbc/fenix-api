-- ADR-006: seguimiento de respuesta del lead a una LeadCampaign ya enviada
-- (reenganche, repeticion, reglas de etiqueta -- y cualquier tipo futuro,
-- ya que todos crean una fila en esta tabla). Columnas nullable y aditivas,
-- sin impacto en filas existentes.

ALTER TABLE "LeadCampaign"
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "responseMessageId" TEXT;

ALTER TABLE "LeadCampaign"
  ADD CONSTRAINT "LeadCampaign_responseMessageId_fkey"
  FOREIGN KEY ("responseMessageId") REFERENCES "Message"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LeadCampaign_responseMessageId_idx" ON "LeadCampaign"("responseMessageId");
CREATE INDEX "LeadCampaign_accountId_type_respondedAt_idx" ON "LeadCampaign"("accountId", "type", "respondedAt");
