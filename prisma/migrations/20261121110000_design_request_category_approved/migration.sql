-- Pedido explicito del usuario, 21/nov/2026: el cliente puede aprobar una
-- solicitud de boceto pero rechazar alguna de sus categorias en concreto
-- (p.ej. aprueba "vasos" y "bolsas" pero no "cajas") -- antes, al aprobar
-- la solicitud entera, las 4 categorias sumaban "aprobada" por igual en
-- el reporte "Por categoria". Default TRUE porque por defecto se
-- aprueban todas; DesignBoardService.approve() es el unico lugar que la
-- cambia (ver ApproveDesignRequestDto.rejectedCategoryIds).

ALTER TABLE "DesignRequestCategoryAssignment" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;
