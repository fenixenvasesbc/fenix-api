-- Pedido explicito del usuario, 23/oct/2026: notificar a TODO el Jefe de
-- Diseño (DESIGNER_MANAGER) cuando una solicitud de boceto entra a "Boceto
-- en revision" (ya que es quien revisa los bocetos antes de aprobarlos) --
-- ver DESIGN_REQUEST_IN_REVIEW en notifications/listeners/
-- design-request-notifications.listener.ts y move() en design-board.service.ts.

ALTER TYPE "AppNotificationType" ADD VALUE 'DESIGN_REQUEST_IN_REVIEW';

ALTER TABLE "DesignBoardColumn" ADD COLUMN "isInReview" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: cualquier tablero ya existente tiene su columna "IN_REVIEW"
-- creada antes de este flag (igual patron que isModification en
-- 20260925190000_design_board_modification_column).
UPDATE "DesignBoardColumn" SET "isInReview" = true WHERE "code" = 'IN_REVIEW';
