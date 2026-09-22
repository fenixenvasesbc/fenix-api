-- Permite que un comercial edite manualmente el nombre mostrado de un lead
-- desde la SPA. Este override tiene prioridad maxima en
-- resolveLeadDisplayName (src/common/utils/lead-name.ts), por encima de los
-- nombres que llegan automaticamente desde WhatsApp/YCloud.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "manualName" TEXT,
ADD COLUMN "manualNameSetByUserId" TEXT,
ADD COLUMN "manualNameSetAt" TIMESTAMP(3);
