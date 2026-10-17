-- ADR-006 seguimiento: la consulta de InboundMessageService que busca si
-- el lead tiene una LeadCampaign SENT sin respuesta ("leadId = X AND
-- status = 'SENT' AND respondedAt IS NULL ORDER BY sentAt DESC LIMIT 1")
-- no estaba cubierta por ningun indice existente -- el unico que empieza
-- por leadId es el UNIQUE(leadId, type, businessWindowKey), que no sirve
-- para filtrar por status/respondedAt. Este indice cubre exactamente esa
-- consulta: leadId como prefijo de igualdad (nunca escanea mas de las
-- pocas filas de ESE lead, jamas la cuenta ni la tabla completa) y sentAt
-- al final para resolver el ORDER BY ... LIMIT 1 sin sort adicional.
CREATE INDEX "LeadCampaign_leadId_status_respondedAt_sentAt_idx"
  ON "LeadCampaign" ("leadId", "status", "respondedAt", "sentAt");
