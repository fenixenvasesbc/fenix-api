-- Pedido explicito del usuario, 28/oct/2026: el Jefe de Diseño necesita
-- distinguir, entre todos los adjuntos de una solicitud, cual es el que
-- el cliente aprobo realmente (lo marca la comercial propietaria o
-- ADMIN) -- ver DesignBoardService.markApprovedVersionAttachment().

ALTER TABLE "DesignRequestAttachment" ADD COLUMN "isApprovedVersion" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "DesignRequestAttachment_designRequestId_isApprovedVersion_idx" ON "DesignRequestAttachment"("designRequestId", "isApprovedVersion");
