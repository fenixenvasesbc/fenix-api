-- ADR-004 Submodulo 2: aprobacion automatica de una solicitud de boceto
-- cuando alguien le pone al lead la etiqueta BOCETO_APROBADO (con bloqueo
-- si no hay ninguna solicitud esperando en "Terminado" -- ver
-- LeadsController.setLabel / DesignBoardService.approveByLabel).

-- AlterTable
ALTER TABLE "DesignRequest" ADD COLUMN "approvedViaLabel" BOOLEAN NOT NULL DEFAULT false;

-- Seed: la nueva label "sistema" BOCETO_APROBADO para cada Account ya
-- existente, siguiendo el mismo patron que la migracion
-- 20260904120000_lead_label_definitions.
INSERT INTO "LeadLabelDefinition"
  ("id", "accountId", "code", "name", "color", "isSystem", "alertThresholdDays", "active", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || a."id" || 'BOCETO_APROBADO')::uuid::text,
  a."id",
  'BOCETO_APROBADO',
  'Boceto aprobado',
  NULL,
  true,
  NULL,
  true,
  7,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Account" a
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadLabelDefinition" d
  WHERE d."accountId" = a."id" AND d."code" = 'BOCETO_APROBADO'
);
