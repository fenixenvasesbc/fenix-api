-- Soporte para mensajes de WhatsApp editados (feature de edicion de Meta),
-- tanto entrantes (whatsapp.inbound_message.received, type="edit") como
-- salientes enviados desde la app de WhatsApp Business
-- (whatsapp.smb.message.echoes, type="edit"). El mensaje original se busca
-- por wamid (edit.originalMessageId) y se actualiza in-place, preservando
-- el texto original la primera vez que se edita.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "editedByProviderEventId" TEXT,
ADD COLUMN "originalTextBody" TEXT;
