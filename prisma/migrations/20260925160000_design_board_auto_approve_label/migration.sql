-- ADR-004 Submodulo 2: aprobacion automatica de una solicitud de boceto
-- cuando alguien le pone al lead la etiqueta BOCETO_APROBADO (con bloqueo
-- si no hay ninguna solicitud esperando en "Terminado" -- ver
-- LeadsController.setLabel / DesignBoardService.approveByLabel).

-- AlterTable
ALTER TABLE "DesignRequest" ADD COLUMN "approvedViaLabel" BOOLEAN NOT NULL DEFAULT false;

-- Seed: la nueva label "sistema" BOCETO_APROBADO. Nota: desde la migracion
-- 20260905142928_lead_label_definitions_global, "LeadLabelDefinition" es un
-- catalogo GLOBAL (una fila por "code", sin "accountId") -- no una copia
-- por Account como en el patron original de 20260904120000.
INSERT INTO "LeadLabelDefinition"
  ("id", "code", "name", "color", "isSystem", "alertThresholdDays", "active", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || 'BOCETO_APROBADO')::uuid::text,
  'BOCETO_APROBADO',
  'Boceto aprobado',
  NULL,
  true,
  NULL,
  true,
  7,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadLabelDefinition" d WHERE d."code" = 'BOCETO_APROBADO'
);
