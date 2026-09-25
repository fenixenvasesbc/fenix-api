-- ADR-004 Submodulo 8: "Aprobados" restringido a DESIGNER_MANAGER/ADMIN y
-- archivado ("Marcar como hecho") desde esa columna.

-- AlterTable
ALTER TABLE "DesignRequest" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "DesignRequest" ADD COLUMN "archivedByUserId" TEXT;
