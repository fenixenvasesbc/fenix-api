-- Pedido explicito del usuario (23/oct/2026):
-- 1. Persistir el tipo de solicitud elegido al crear (requestType), hasta
--    ahora solo se usaba de forma transitoria para calcular el plazo y se
--    descartaba -- lo necesitamos para mostrarlo en el detalle y para
--    poder editarlo despues. Nullable: no se puede reconstruir
--    retroactivamente en solicitudes ya existentes.
-- 2. Eliminacion logica de una solicitud (deletedAt/deletedByUserId),
--    mismo criterio que archivedAt: el registro se conserva en la base,
--    solo deja de ser visible en el tablero y en los listados.
-- Columnas nullable y aditivas, sin impacto en filas existentes.

ALTER TABLE "DesignRequest"
  ADD COLUMN "requestType" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;
