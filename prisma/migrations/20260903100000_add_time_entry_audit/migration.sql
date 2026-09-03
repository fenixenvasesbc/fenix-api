-- Auditoria de ediciones manuales de fichajes (hora entrada/salida) hechas
-- por ADMIN o FACTORY_MANAGER desde "Mis horas". timeEntryId es nullable y
-- la FK es ON DELETE SET NULL a proposito: al eliminar un fichaje normal
-- (TimeEntriesService.removeEntry) la auditoria NO se borra, queda como
-- registro huerfano para conservar el rastro de quien edito que. Solo se
-- borra junto con el purge total del modulo (TimeTrackingPurgeService).
CREATE TABLE "TimeEntryAudit" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "performedByUserId" TEXT NOT NULL,
    "performedByEmail" TEXT NOT NULL,
    "previousClockInAt" TIMESTAMP(3) NOT NULL,
    "previousClockOutAt" TIMESTAMP(3),
    "newClockInAt" TIMESTAMP(3) NOT NULL,
    "newClockOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntryAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeEntryAudit_timeEntryId_idx" ON "TimeEntryAudit"("timeEntryId");

ALTER TABLE "TimeEntryAudit" ADD CONSTRAINT "TimeEntryAudit_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
