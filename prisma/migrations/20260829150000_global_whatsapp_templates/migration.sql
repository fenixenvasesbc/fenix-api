-- Gestion global de plantillas de WhatsApp: una plantilla se crea una vez y
-- se replica en el WABA de cada comercial, con su propio estado de aprobacion.

CREATE TYPE "AccountGlobalTemplateStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'ERROR');

CREATE TABLE "GlobalWhatsappTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalWhatsappTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalWhatsappTemplate_name_language_key" ON "GlobalWhatsappTemplate"("name", "language");

CREATE INDEX "GlobalWhatsappTemplate_createdAt_idx" ON "GlobalWhatsappTemplate"("createdAt");

ALTER TABLE "GlobalWhatsappTemplate"
  ADD CONSTRAINT "GlobalWhatsappTemplate_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GlobalWhatsappTemplateAccount" (
    "id" TEXT NOT NULL,
    "globalTemplateId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "officialTemplateId" TEXT,
    "status" "AccountGlobalTemplateStatus" NOT NULL DEFAULT 'PENDING',
    "statusDetail" TEXT,
    "lastWebhookPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalWhatsappTemplateAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalWhatsappTemplateAccount_globalTemplateId_accountId_key" ON "GlobalWhatsappTemplateAccount"("globalTemplateId", "accountId");

CREATE INDEX "GlobalWhatsappTemplateAccount_wabaId_idx" ON "GlobalWhatsappTemplateAccount"("wabaId");

CREATE INDEX "GlobalWhatsappTemplateAccount_status_idx" ON "GlobalWhatsappTemplateAccount"("status");

ALTER TABLE "GlobalWhatsappTemplateAccount"
  ADD CONSTRAINT "GlobalWhatsappTemplateAccount_globalTemplateId_fkey"
  FOREIGN KEY ("globalTemplateId") REFERENCES "GlobalWhatsappTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GlobalWhatsappTemplateAccount"
  ADD CONSTRAINT "GlobalWhatsappTemplateAccount_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
