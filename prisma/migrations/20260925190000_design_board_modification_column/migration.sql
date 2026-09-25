-- ADR-004 Submodulo 4: columna "Modificacion" con plazo especial.

ALTER TABLE "DesignBoardColumn" ADD COLUMN "isModification" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DesignBoardColumn" ADD COLUMN "modificationSlaBusinessDays" INTEGER;

ALTER TABLE "DesignRequest" ADD COLUMN "sentToModificationAt" TIMESTAMP(3);

-- Para cada tablero existente que ya tenga sus columnas por defecto
-- (NEW=0, IN_REVIEW=1, DONE=2, APPROVED=3), hay que abrir el hueco en
-- sortOrder=1 antes de insertar "Modificacion". Se desplazan
-- APPROVED/DONE/IN_REVIEW un paso hacia adelante, en TRES statements
-- separados y en orden estrictamente descendente (APPROVED primero, luego
-- DONE, luego IN_REVIEW) para nunca chocar con la restriccion
-- unique(boardId, sortOrder) -- cada UPDATE se confirma antes del
-- siguiente dentro de la misma transaccion de la migracion.
UPDATE "DesignBoardColumn" c
SET "sortOrder" = c."sortOrder" + 1
WHERE c.code = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM "DesignBoardColumn" mc
    WHERE mc."boardId" = c."boardId" AND mc.code = 'MODIFICATION'
  );

UPDATE "DesignBoardColumn" c
SET "sortOrder" = c."sortOrder" + 1
WHERE c.code = 'DONE'
  AND NOT EXISTS (
    SELECT 1 FROM "DesignBoardColumn" mc
    WHERE mc."boardId" = c."boardId" AND mc.code = 'MODIFICATION'
  );

UPDATE "DesignBoardColumn" c
SET "sortOrder" = c."sortOrder" + 1
WHERE c.code = 'IN_REVIEW'
  AND NOT EXISTS (
    SELECT 1 FROM "DesignBoardColumn" mc
    WHERE mc."boardId" = c."boardId" AND mc.code = 'MODIFICATION'
  );

INSERT INTO "DesignBoardColumn"
  ("id", "boardId", "code", "name", "sortOrder", "isInitial", "isModification", "isFinal", "isApproved", "modificationSlaBusinessDays", "active")
SELECT gen_random_uuid(), b."id", 'MODIFICATION', 'Modificación', 1, false, true, false, false, 1, true
FROM "DesignBoard" b
WHERE EXISTS (
  SELECT 1 FROM "DesignBoardColumn" nc WHERE nc."boardId" = b."id" AND nc.code = 'NEW'
)
AND NOT EXISTS (
  SELECT 1 FROM "DesignBoardColumn" mc WHERE mc."boardId" = b."id" AND mc.code = 'MODIFICATION'
);
