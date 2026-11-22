-- ADR-007 (22/nov/2026): Suiza como pais de solicitudes de boceto y de
-- familias de inversion. Migracion separada: un valor nuevo de enum no se
-- puede usar en la misma transaccion en la que se agrega, y la siguiente
-- migracion siembra familias con country = 'CH'.
ALTER TYPE "DesignRequestCountry" ADD VALUE IF NOT EXISTS 'CH';
