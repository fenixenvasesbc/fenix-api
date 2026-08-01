-- CreateEnum
CREATE TYPE "EmployeeContractType" AS ENUM ('FIJO', 'POR_HORAS');

-- CreateEnum
CREATE TYPE "TimeEntryRateType" AS ENUM ('OVERTIME_WEEKDAY', 'OVERTIME_SATURDAY', 'HOURLY');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FACTORY_MANAGER';

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractType" "EmployeeContractType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "clockInByUserId" TEXT,
    "clockOutByUserId" TEXT,
    "totalMinutes" INTEGER,
    "payableHours" INTEGER,
    "rateType" "TimeEntryRateType",
    "rateApplied" DECIMAL(10,2),
    "amount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeTrackingRate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "overtimeWeekdayRate" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "overtimeSaturdayRate" DECIMAL(10,2) NOT NULL DEFAULT 15,
    "hourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 8,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeTrackingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_isActive_name_idx" ON "Employee"("isActive", "name");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_clockInAt_idx" ON "TimeEntry"("employeeId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_clockOutAt_idx" ON "TimeEntry"("employeeId", "clockOutAt");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

