-- ADR-002: reglas configurables de mensajes de WhatsApp por etiqueta.
-- Agrega el rol SUPPORT (ve todo lo que ADMIN via ROLE_INHERITANCE, y es el
-- unico que puede administrar LabelMessageRule), el tipo de LeadCampaign
-- LABEL_RULE (dedupe/cola del nuevo job, mismo patron que REPETITION_REMINDER)
-- y la tabla LabelMessageRule en si.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPPORT';

-- AlterEnum
ALTER TYPE "LeadCampaignType" ADD VALUE 'LABEL_RULE';

-- CreateTable
CREATE TABLE "LabelMessageRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "labelCode" TEXT NOT NULL,
    "triggerAfterDays" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelMessageRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabelMessageRule_active_labelCode_idx" ON "LabelMessageRule"("active", "labelCode");

-- AddForeignKey
ALTER TABLE "LabelMessageRule" ADD CONSTRAINT "LabelMessageRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
