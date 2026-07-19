-- Track media uploaded by the SPA before it is attached to an outbound message.
-- This lets the API reuse already-uploaded YCloud media on retry and clean
-- temporary local files that never became messages.

CREATE TYPE "MediaUploadStatus" AS ENUM ('UPLOADED', 'ATTACHED', 'FAILED', 'EXPIRED');

CREATE TABLE "MediaUpload" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "messageId" TEXT,
    "provider" "ProviderType" NOT NULL DEFAULT 'YCLOUD',
    "providerMediaId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mediaUrl" TEXT,
    "mediaStorageDriver" TEXT,
    "mediaStorageKey" TEXT,
    "mediaExpiresAt" TIMESTAMP(3),
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "attachedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MediaUpload_accountId_status_createdAt_idx" ON "MediaUpload"("accountId", "status", "createdAt");

CREATE INDEX "MediaUpload_status_mediaExpiresAt_idx" ON "MediaUpload"("status", "mediaExpiresAt");

CREATE INDEX "MediaUpload_mediaStorageKey_idx" ON "MediaUpload"("mediaStorageKey");

CREATE INDEX "MediaUpload_providerMediaId_idx" ON "MediaUpload"("providerMediaId");
