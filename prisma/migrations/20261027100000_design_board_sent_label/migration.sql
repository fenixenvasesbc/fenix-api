-- Pedido explicito del usuario, 27/oct/2026: al reenviar el boceto
-- terminado al lead (DesignBoardService.forwardAttachment, solo mientras
-- la tarjeta sigue en "Terminado") se le pone la etiqueta BOCETO_ENVIADO,
-- que reemplaza a BOCETO_EN_PROCESO (currentLabel es un valor unico) --
-- antes esa etiqueta solo se quitaba al aprobar el boceto (BOCETO_APROBADO).

-- Seed: la nueva label "sistema" BOCETO_ENVIADO. Mismo patron que
-- 20260925160000_design_board_auto_approve_label (BOCETO_APROBADO):
-- "LeadLabelDefinition" es un catalogo GLOBAL desde
-- 20260905142928_lead_label_definitions_global (una fila por "code", sin
-- "accountId").
INSERT INTO "LeadLabelDefinition"
  ("id", "code", "name", "color", "isSystem", "alertThresholdDays", "active", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || 'BOCETO_ENVIADO')::uuid::text,
  'BOCETO_ENVIADO',
  'Boceto enviado',
  NULL,
  true,
  NULL,
  true,
  8,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadLabelDefinition" d WHERE d."code" = 'BOCETO_ENVIADO'
);
