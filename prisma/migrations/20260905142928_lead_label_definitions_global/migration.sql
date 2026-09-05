-- Convierte "LeadLabelDefinition" de "una copia por Account" a un catalogo
-- GLOBAL compartido por todas las cuentas (el usuario pidio que las
-- etiquetas apliquen a todas las cuentas, no una por cuenta).
--
-- En produccion ya existen filas duplicadas (una por cada Account x code,
-- todas sembradas identicas para las 6 labels de sistema). Este migration:
--   1. Consolida: para cada "code" conserva una sola fila (la mas antigua)
--      y borra el resto.
--   2. Quita la FK/columna "accountId".
--   3. Reemplaza los indices por unicos/globales.

-- Consolidar duplicados por code (conserva la fila mas antigua de cada
-- code; en un entorno recien sembrado no hay diferencias entre copias).
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY code ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "LeadLabelDefinition"
)
DELETE FROM "LeadLabelDefinition"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- DropForeignKey
ALTER TABLE "LeadLabelDefinition" DROP CONSTRAINT IF EXISTS "LeadLabelDefinition_accountId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "LeadLabelDefinition_accountId_code_key";
DROP INDEX IF EXISTS "LeadLabelDefinition_accountId_active_sortOrder_idx";

-- AlterTable
ALTER TABLE "LeadLabelDefinition" DROP COLUMN IF EXISTS "accountId";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadLabelDefinition_code_key" ON "LeadLabelDefinition"("code");
CREATE INDEX IF NOT EXISTS "LeadLabelDefinition_active_sortOrder_idx" ON "LeadLabelDefinition"("active", "sortOrder");
