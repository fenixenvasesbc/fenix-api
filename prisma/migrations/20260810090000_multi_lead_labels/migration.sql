-- CreateTable
CREATE TABLE "LeadLabelAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" "LeadLabel" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadLabelAssignment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "LeadRepetitionReminder" ADD COLUMN "labelAssignmentId" TEXT;

-- Backfill active assignments from the legacy current label.
INSERT INTO "LeadLabelAssignment" (
    "id",
    "leadId",
    "accountId",
    "label",
    "assignedAt",
    "metadata",
    "createdAt",
    "updatedAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text || l."id"),
    l."id",
    l."accountId",
    l."currentLabel",
    COALESCE(l."currentLabelChangedAt", l."updatedAt", l."createdAt", CURRENT_TIMESTAMP),
    jsonb_build_object('source', 'backfill_currentLabel'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Lead" l
WHERE l."accountId" IS NOT NULL
  AND l."currentLabel" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Link existing repetition reminders to the active REPETICIONES assignment when possible.
UPDATE "LeadRepetitionReminder" r
SET "labelAssignmentId" = a."id"
FROM "LeadLabelAssignment" a
WHERE a."leadId" = r."leadId"
  AND a."accountId" = r."accountId"
  AND a."label" = 'REPETICIONES'
  AND a."removedAt" IS NULL
  AND r."labelAssignmentId" IS NULL;

-- CreateIndex
CREATE INDEX "LeadLabelAssignment_accountId_label_removedAt_assignedAt_idx" ON "LeadLabelAssignment"("accountId", "label", "removedAt", "assignedAt");
CREATE INDEX "LeadLabelAssignment_leadId_removedAt_idx" ON "LeadLabelAssignment"("leadId", "removedAt");
CREATE INDEX "LeadLabelAssignment_leadId_label_idx" ON "LeadLabelAssignment"("leadId", "label");
CREATE INDEX "LeadRepetitionReminder_labelAssignmentId_idx" ON "LeadRepetitionReminder"("labelAssignmentId");

-- One active assignment per lead and label.
CREATE UNIQUE INDEX "LeadLabelAssignment_active_unique"
ON "LeadLabelAssignment"("leadId", "label")
WHERE "removedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "LeadLabelAssignment" ADD CONSTRAINT "LeadLabelAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadLabelAssignment" ADD CONSTRAINT "LeadLabelAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadRepetitionReminder" ADD CONSTRAINT "LeadRepetitionReminder_labelAssignmentId_fkey" FOREIGN KEY ("labelAssignmentId") REFERENCES "LeadLabelAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
