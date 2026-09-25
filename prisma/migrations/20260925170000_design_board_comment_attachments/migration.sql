-- ADR-004 Submodulo 3: comentarios con adjuntos. Un DesignRequestAttachment
-- ahora puede colgar de un DesignRequestComment en vez de (o ademas de)
-- colgar directo de la DesignRequest.

-- AlterTable: designRequestId pasa a ser opcional.
ALTER TABLE "DesignRequestAttachment" ALTER COLUMN "designRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DesignRequestAttachment" ADD COLUMN "commentId" TEXT;

-- CreateIndex
CREATE INDEX "DesignRequestAttachment_commentId_idx" ON "DesignRequestAttachment"("commentId");

-- AddForeignKey
ALTER TABLE "DesignRequestAttachment" ADD CONSTRAINT "DesignRequestAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "DesignRequestComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
