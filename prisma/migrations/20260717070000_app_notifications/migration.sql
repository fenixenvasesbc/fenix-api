CREATE TYPE "AppNotificationType" AS ENUM ('LABEL_STALE');

CREATE TYPE "AppNotificationStatus" AS ENUM ('UNREAD', 'READ');

CREATE TYPE "AppNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" "AppNotificationType" NOT NULL,
    "status" "AppNotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "severity" "AppNotificationSeverity" NOT NULL DEFAULT 'WARNING',
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "label" "LeadLabel",
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppNotification_accountId_dedupeKey_key" ON "AppNotification"("accountId", "dedupeKey");
CREATE INDEX "AppNotification_accountId_status_triggeredAt_idx" ON "AppNotification"("accountId", "status", "triggeredAt");
CREATE INDEX "AppNotification_accountId_type_status_idx" ON "AppNotification"("accountId", "type", "status");
CREATE INDEX "AppNotification_leadId_type_status_idx" ON "AppNotification"("leadId", "type", "status");

ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
