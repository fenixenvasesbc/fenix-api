-- Soporte para reacciones (emoji) a mensajes de WhatsApp. YCloud las manda
-- como un evento whatsapp.inbound_message.received con type="reaction",
-- referenciando el wamid del mensaje reaccionado en reaction.message_id.
-- No se guarda como un mensaje nuevo en el hilo, sino como metadata sobre
-- el mensaje original (igual que la edicion).

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "reactionEmoji" TEXT,
ADD COLUMN "reactedAt" TIMESTAMP(3),
ADD COLUMN "reactedByProviderEventId" TEXT;
