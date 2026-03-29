-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "whatsappParentUserId" TEXT,
ADD COLUMN     "whatsappUserId" TEXT,
ADD COLUMN     "whatsappUsername" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "customerDisplayName" TEXT,
ADD COLUMN     "customerUsername" TEXT,
ADD COLUMN     "recipientParentUserId" TEXT,
ADD COLUMN     "recipientWhatsAppUserId" TEXT,
ADD COLUMN     "senderParentUserId" TEXT,
ADD COLUMN     "senderWhatsAppUserId" TEXT;
