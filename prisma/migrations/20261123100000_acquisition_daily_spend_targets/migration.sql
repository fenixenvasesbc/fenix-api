-- ADR-007 (23/nov/2026): la inversion pasa de semanal a DIARIA "vigente hasta
-- que la cambies", se anade el objetivo de coste por mensaje con historial por
-- fecha y la etiqueta que marca "Presupuesto enviado".

-- 1) Inversion diaria
CREATE TABLE "FamilySpendRate" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "dailyAmountCents" INTEGER NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilySpendRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilySpendRate_familyId_effectiveFrom_key" ON "FamilySpendRate"("familyId", "effectiveFrom");
ALTER TABLE "FamilySpendRate" ADD CONSTRAINT "FamilySpendRate_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "InvestmentFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Objetivo de coste por mensaje
CREATE TABLE "FamilyLeadTarget" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "targetCentsPerLead" INTEGER,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilyLeadTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyLeadTarget_familyId_effectiveFrom_key" ON "FamilyLeadTarget"("familyId", "effectiveFrom");
ALTER TABLE "FamilyLeadTarget" ADD CONSTRAINT "FamilyLeadTarget_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "InvestmentFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Ajustes del modulo + etiqueta de presupuesto (se busca por nombre;
--    editable despues en Configuracion > Campañas y familias)
CREATE TABLE "AcquisitionSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "quoteLabelCode" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionSettings_pkey" PRIMARY KEY ("id")
);
INSERT INTO "AcquisitionSettings" ("id", "quoteLabelCode", "updatedAt")
VALUES (
  'default',
  (SELECT d."code" FROM "LeadLabelDefinition" d
    WHERE lower(d."name") LIKE '%presupuesto%enviado%'
    ORDER BY d."active" DESC, d."sortOrder" ASC
    LIMIT 1),
  CURRENT_TIMESTAMP
);

CREATE INDEX "LeadLabelAssignment_label_assignedAt_idx" ON "LeadLabelAssignment"("label", "assignedAt");

-- 4) Migrar la inversion semanal cargada (lunes-domingo) a importe diario:
--    importe/7 desde el lunes de esa semana y 0 desde el lunes siguiente si
--    esa semana no tenia inversion (para que no se arrastre).
INSERT INTO "FamilySpendRate" ("id", "familyId", "effectiveFrom", "dailyAmountCents", "updatedByUserId", "updatedAt")
SELECT md5('spend-rate:' || s."familyId" || ':' || s."weekStart"::text)::uuid::text,
       s."familyId", s."weekStart", ROUND(s."amountCents" / 7.0)::int, s."updatedByUserId", CURRENT_TIMESTAMP
FROM "FamilyWeeklySpend" s;

INSERT INTO "FamilySpendRate" ("id", "familyId", "effectiveFrom", "dailyAmountCents", "updatedAt")
SELECT md5('spend-rate:' || s."familyId" || ':' || (s."weekStart" + 7)::text)::uuid::text,
       s."familyId", s."weekStart" + 7, 0, CURRENT_TIMESTAMP
FROM "FamilyWeeklySpend" s
WHERE NOT EXISTS (
  SELECT 1 FROM "FamilyWeeklySpend" n
  WHERE n."familyId" = s."familyId" AND n."weekStart" = s."weekStart" + 7
);

DROP TABLE "FamilyWeeklySpend";
