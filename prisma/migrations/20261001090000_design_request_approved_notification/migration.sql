-- Nuevo valor de AppNotificationType para notificar al diseñador asignado
-- y al Jefe de Diseño (DESIGNER_MANAGER) cuando una solicitud de boceto
-- pasa a "Aprobados" (ver design-board.service.ts approve()/approveByLabel()
-- y notifications/listeners/design-request-notifications.listener.ts).
ALTER TYPE "AppNotificationType" ADD VALUE 'DESIGN_REQUEST_APPROVED';
