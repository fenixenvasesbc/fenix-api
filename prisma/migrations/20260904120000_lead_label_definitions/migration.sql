-- Reemplaza el enum fijo "LeadLabel" por una tabla configurable
-- (LeadLabelDefinition), para poder definir/editar labels y su umbral de
-- alerta in-app (dias en label -> AppNotification) desde la UI.
--
-- IMPORTANTE: esto NO toca el sistema de envio automatico de WhatsApp
-- (LeadRepetitionReminder / RepetitionReminderScheduler / Dispatch). Esos
-- jobs siguen comparando el mismo valor de texto "REPETICIONES" que antes
-- guardaba el enum; solo cambia que la columna ahora es TEXT en vez de un
-- tipo enum de Postgres. Las 6 labels existentes se siembran como
-- "sistema" (isSystem = true) para cada Account ya existente, con el mismo
-- nombre y umbral de dias que estaban hardcodeados en
-- notifications.service.ts (DEFAULT_LABEL_ALERT_DAYS / LABEL_DISPLAY_NAMES).

-- CreateTable
CREATE TABLE "LeadLabelDefinition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "alertThresholdDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadLabelDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadLabelDefinition_accountId_code_key" ON "LeadLabelDefinition"("accountId", "code");

-- CreateIndex
CREATE INDEX "LeadLabelDefinition_accountId_active_sortOrder_idx" ON "LeadLabelDefinition"("accountId", "active", "sortOrder");

-- AddForeignKey
ALTER TABLE "LeadLabelDefinition" ADD CONSTRAINT "LeadLabelDefinition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: una fila "sistema" por cada Account existente para cada una de las
-- 6 labels que antes eran el enum LeadLabel.
INSERT INTO "LeadLabelDefinition"
  ("id", "accountId", "code", "name", "color", "isSystem", "alertThresholdDays", "active", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || a."id" || d.code)::uuid::text,
  a."id",
  d.code,
  d.name,
  NULL,
  true,
  d."alertThresholdDays",
  true,
  d."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Account" a
CROSS JOIN (
  VALUES
    ('PRODUCCION', 'Produccion', 14, 1),
    ('BOCETO_EN_PROCESO', 'Boceto en proceso', 4, 2),
    ('PENDIENTE_DE_PAGO', 'Pendiente de pago', 7, 3),
    ('MUESTRAS', 'Muestras', 7, 4),
    ('REPETICIONES', 'Repeticiones', NULL, 5),
    ('BOCETOS_ATRASADOS', 'Boceto atrasado', 2, 6)
) AS d("code", "name", "alertThresholdDays", "sortOrder");

-- AlterTable: convertir las columnas que usaban el enum LeadLabel a TEXT.
-- El valor almacenado (ej. 'REPETICIONES') no cambia, solo el tipo.
ALTER TABLE "Lead" ALTER COLUMN "currentLabel" TYPE TEXT USING "currentLabel"::text;
ALTER TABLE "LeadLabelHistory" ALTER COLUMN "fromLabel" TYPE TEXT USING "fromLabel"::text;
ALTER TABLE "LeadLabelHistory" ALTER COLUMN "toLabel" TYPE TEXT USING "toLabel"::text;
ALTER TABLE "LeadLabelAssignment" ALTER COLUMN "label" TYPE TEXT USING "label"::text;
ALTER TABLE "AppNotification" ALTER COLUMN "label" TYPE TEXT USING "label"::text;

-- DropEnum
DROP TYPE "LeadLabel";
