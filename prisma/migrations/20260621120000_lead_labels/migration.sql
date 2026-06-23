-- CreateEnum
CREATE TYPE "LeadLabel" AS ENUM ('PRODUCCION', 'BOCETO_EN_PROCESO', 'PENDIENTE_DE_PAGO', 'MUESTRAS', 'REPETICIONES', 'BOCETOS_ATRASADOS');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "currentLabel" "LeadLabel";
ALTER TABLE "Lead" ADD COLUMN "currentLabelChangedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "repetitionReminderDays" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "nextRepetitionReminderAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadLabelHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromLabel" "LeadLabel",
    "toLabel" "LeadLabel" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,

    CONSTRAINT "LeadLabelHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadRepetitionReminder" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "labelHistoryId" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reminderDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadRepetitionReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_accountId_currentLabel_updatedAt_idx" ON "Lead"("accountId", "currentLabel", "updatedAt");

-- CreateIndex
CREATE INDEX "Lead_accountId_nextRepetitionReminderAt_idx" ON "Lead"("accountId", "nextRepetitionReminderAt");

-- CreateIndex
CREATE INDEX "LeadLabelHistory_accountId_toLabel_changedAt_idx" ON "LeadLabelHistory"("accountId", "toLabel", "changedAt");

-- CreateIndex
CREATE INDEX "LeadLabelHistory_leadId_changedAt_idx" ON "LeadLabelHistory"("leadId", "changedAt");

-- CreateIndex
CREATE INDEX "LeadRepetitionReminder_accountId_dueAt_sentAt_canceledAt_idx" ON "LeadRepetitionReminder"("accountId", "dueAt", "sentAt", "canceledAt");

-- CreateIndex
CREATE INDEX "LeadRepetitionReminder_leadId_markedAt_idx" ON "LeadRepetitionReminder"("leadId", "markedAt");

-- CreateIndex
CREATE INDEX "LeadRepetitionReminder_labelHistoryId_idx" ON "LeadRepetitionReminder"("labelHistoryId");

-- AddForeignKey
ALTER TABLE "LeadLabelHistory" ADD CONSTRAINT "LeadLabelHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadLabelHistory" ADD CONSTRAINT "LeadLabelHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadRepetitionReminder" ADD CONSTRAINT "LeadRepetitionReminder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadRepetitionReminder" ADD CONSTRAINT "LeadRepetitionReminder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
