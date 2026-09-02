-- Nuevos tipos de tarifa: domingo y festivo. En su propia migracion porque
-- Postgres no permite usar un valor de enum recien agregado dentro de la
-- misma transaccion en la que se agrega.
ALTER TYPE "TimeEntryRateType" ADD VALUE 'OVERTIME_SUNDAY';
ALTER TYPE "TimeEntryRateType" ADD VALUE 'OVERTIME_HOLIDAY';
