-- Pedido explicito del usuario, 09/nov/2026: poder setear el precio por
-- hora de manera individual por empleado (pensado para contrato
-- POR_HORAS, que es el unico que usa TimeTrackingRate.hourlyRate -- ver
-- TimeEntriesService.computeFinancials). Opcional a proposito: si el
-- empleado no tiene valor propio, se sigue usando la tarifa global
-- "Hora laboral suelta" de TimeTrackingRate.hourlyRate, sin cambios.
-- Las tarifas de hora extra (festivo/sabado/domingo/entre semana) siguen
-- siendo exclusivamente globales -- este campo no las afecta.

ALTER TABLE "Employee" ADD COLUMN "hourlyRate" DECIMAL(10,2);
