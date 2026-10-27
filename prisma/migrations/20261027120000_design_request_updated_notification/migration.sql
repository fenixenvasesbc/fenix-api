-- Pedido explicito del usuario, 27/oct/2026: notificar al diseñador
-- asignado cuando la comercial propietaria (o ADMIN) edita un dato de la
-- solicitud (titulo/instrucciones/pais/tipo) -- ver
-- DESIGN_REQUEST_UPDATED en notifications/listeners/
-- design-request-notifications.listener.ts y updateRequest() en
-- design-board.service.ts.

ALTER TYPE "AppNotificationType" ADD VALUE 'DESIGN_REQUEST_UPDATED';
