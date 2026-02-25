/*
  Warnings:

  - Made the column `phoneE164` on table `Lead` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "phoneE164" SET NOT NULL;
