/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");
