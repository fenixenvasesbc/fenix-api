ALTER TABLE "Message"
ADD COLUMN "mediaOriginalUrl" TEXT,
ADD COLUMN "mediaStorageDriver" TEXT,
ADD COLUMN "mediaStorageKey" TEXT,
ADD COLUMN "mediaSizeBytes" INTEGER,
ADD COLUMN "mediaStoredAt" TIMESTAMP(3),
ADD COLUMN "mediaExpiresAt" TIMESTAMP(3),
ADD COLUMN "mediaExpiredAt" TIMESTAMP(3);

CREATE INDEX "Message_mediaStorageDriver_mediaStoredAt_idx" ON "Message"("mediaStorageDriver", "mediaStoredAt");
CREATE INDEX "Message_mediaExpiresAt_idx" ON "Message"("mediaExpiresAt");
