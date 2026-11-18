-- Hora real del mensaje (occurredAt).
--
-- Hasta ahora la bandeja ordenaba y mostraba los mensajes por "createdAt"
-- (momento en que Fenix guardó la fila). Todos los flujos ya guardan la hora
-- real de WhatsApp en providerSendTime / providerCreateTime, pero un mensaje
-- guardado tarde (importación de historial, reintentos de RabbitMQ,
-- reconstrucción de salientes enviados fuera de Fenix) aparecía con la hora y
-- en la posición equivocadas.
--
-- occurredAt = COALESCE(providerSendTime, providerCreateTime, createdAt) y lo
-- mantiene un trigger, para que ningún flujo (actual o futuro, incluidos los
-- scripts) tenga que acordarse de rellenarlo.

-- 1. Columna + relleno de los mensajes existentes
ALTER TABLE "Message" ADD COLUMN "occurredAt" TIMESTAMP(3);

UPDATE "Message"
SET "occurredAt" = COALESCE("providerSendTime", "providerCreateTime", "createdAt");

ALTER TABLE "Message"
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurredAt" SET NOT NULL;

-- 2. Trigger que lo mantiene
CREATE OR REPLACE FUNCTION message_set_occurred_at() RETURNS trigger AS $$
BEGIN
  NEW."occurredAt" := COALESCE(
    NEW."providerSendTime",
    NEW."providerCreateTime",
    NEW."createdAt",
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_set_occurred_at_insert
  BEFORE INSERT ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_set_occurred_at();

CREATE TRIGGER message_set_occurred_at_update
  BEFORE UPDATE OF "providerSendTime", "providerCreateTime", "createdAt", "occurredAt" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_set_occurred_at();

-- 3. Índice para listar/paginar la conversación por hora real
CREATE INDEX "Message_accountId_leadId_occurredAt_id_idx"
  ON "Message"("accountId", "leadId", "occurredAt", "id");
