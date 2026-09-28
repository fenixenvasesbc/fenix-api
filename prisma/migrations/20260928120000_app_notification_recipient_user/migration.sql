-- Notificaciones dirigidas a un usuario puntual (ej. el diseñador asignado
-- a un boceto), separado del flujo existente por accountId (SALES/ADMIN).
-- Ver conversacion: sistema de alertas de bocetos reescrito con
-- EventEmitter2 (patron Observer) + este campo para que DESIGNER/
-- DESIGNER_MANAGER (sin accountId propio) puedan recibir notificaciones.
ALTER TABLE "AppNotification" ADD COLUMN "recipientUserId" TEXT;

CREATE INDEX "AppNotification_recipientUserId_status_triggeredAt_idx"
  ON "AppNotification"("recipientUserId", "status", "triggeredAt");
