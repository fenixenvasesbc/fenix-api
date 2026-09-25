-- ADR-004 Submodulo 1: plazos en dias habiles con corte de las 14:00 hora
-- Europe/Madrid, reemplazando el placeholder de dias corridos del MVP core.

-- AlterTable
ALTER TABLE "DesignBoard" ADD COLUMN "slaCutoffHour" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "DesignRequest" ADD COLUMN "slaBusinessDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "DesignRequest" ADD COLUMN "overdueLabelAppliedAt" TIMESTAMP(3);
