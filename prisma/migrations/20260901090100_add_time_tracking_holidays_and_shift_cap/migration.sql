-- Alcance de un festivo
CREATE TYPE "HolidayScope" AS ENUM ('NATIONAL', 'REGIONAL', 'LOCAL');

-- TimeEntry: marca de turno topado por el limite configurado
ALTER TABLE "TimeEntry" ADD COLUMN "wasCapped" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "TimeEntry_wasCapped_idx" ON "TimeEntry"("wasCapped");

-- TimeTrackingRate: tarifas de domingo/festivo + tope configurable de turno
ALTER TABLE "TimeTrackingRate" ADD COLUMN "overtimeSundayRate" DECIMAL(10,2) NOT NULL DEFAULT 18;
ALTER TABLE "TimeTrackingRate" ADD COLUMN "overtimeHolidayRate" DECIMAL(10,2) NOT NULL DEFAULT 20;
ALTER TABLE "TimeTrackingRate" ADD COLUMN "maxShiftEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TimeTrackingRate" ADD COLUMN "maxShiftMinutes" INTEGER NOT NULL DEFAULT 720;

-- Calendario de festivos
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "HolidayScope" NOT NULL DEFAULT 'NATIONAL',
    "region" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicHoliday_date_key" ON "PublicHoliday"("date");
CREATE INDEX "PublicHoliday_date_idx" ON "PublicHoliday"("date");
