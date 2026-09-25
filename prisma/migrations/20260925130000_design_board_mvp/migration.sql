-- ADR-004: Modulo de solicitudes de bocetos (tablero tipo Jira) -- MVP core.
-- Agrega los roles DESIGNER/DESIGNER_MANAGER, el tipo de notificacion
-- DESIGN_REQUEST_READY, y las tablas del tablero (DesignBoard,
-- DesignBoardColumn, DesignRequest, DesignRequestAttachment,
-- DesignRequestComment, DesignRequestStatusEvent).

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DESIGNER';
ALTER TYPE "Role" ADD VALUE 'DESIGNER_MANAGER';

-- AlterEnum
ALTER TYPE "AppNotificationType" ADD VALUE 'DESIGN_REQUEST_READY';

-- CreateEnum
CREATE TYPE "DesignRequestCountry" AS ENUM ('ES', 'FR', 'IT', 'DE');

-- CreateEnum
CREATE TYPE "DesignAttachmentKind" AS ENUM ('FROM_CHAT', 'UPLOADED');

-- CreateTable
CREATE TABLE "DesignBoard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultSlaDays" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignBoardColumn" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DesignBoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "country" "DesignRequestCountry" NOT NULL DEFAULT 'ES',
    "instructions" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedByUserId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRequestAttachment" (
    "id" TEXT NOT NULL,
    "designRequestId" TEXT NOT NULL,
    "kind" "DesignAttachmentKind" NOT NULL,
    "sourceMessageId" TEXT,
    "mediaUrl" TEXT,
    "mediaStorageKey" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "uploadedByUserId" TEXT NOT NULL,
    "forwardedToLeadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRequestComment" (
    "id" TEXT NOT NULL,
    "designRequestId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRequestStatusEvent" (
    "id" TEXT NOT NULL,
    "designRequestId" TEXT NOT NULL,
    "fromColumnId" TEXT,
    "toColumnId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRequestStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignBoardColumn_boardId_code_key" ON "DesignBoardColumn"("boardId", "code");
CREATE UNIQUE INDEX "DesignBoardColumn_boardId_sortOrder_key" ON "DesignBoardColumn"("boardId", "sortOrder");
CREATE INDEX "DesignBoardColumn_boardId_active_sortOrder_idx" ON "DesignBoardColumn"("boardId", "active", "sortOrder");

CREATE INDEX "DesignRequest_boardId_columnId_idx" ON "DesignRequest"("boardId", "columnId");
CREATE INDEX "DesignRequest_accountId_createdByUserId_idx" ON "DesignRequest"("accountId", "createdByUserId");
CREATE INDEX "DesignRequest_assignedUserId_idx" ON "DesignRequest"("assignedUserId");
CREATE INDEX "DesignRequest_dueAt_idx" ON "DesignRequest"("dueAt");

CREATE INDEX "DesignRequestAttachment_designRequestId_idx" ON "DesignRequestAttachment"("designRequestId");

CREATE INDEX "DesignRequestComment_designRequestId_createdAt_idx" ON "DesignRequestComment"("designRequestId", "createdAt");

CREATE INDEX "DesignRequestStatusEvent_designRequestId_changedAt_idx" ON "DesignRequestStatusEvent"("designRequestId", "changedAt");

-- AddForeignKey
ALTER TABLE "DesignBoardColumn" ADD CONSTRAINT "DesignBoardColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "DesignBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "DesignBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DesignBoardColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequestAttachment" ADD CONSTRAINT "DesignRequestAttachment_designRequestId_fkey" FOREIGN KEY ("designRequestId") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignRequestAttachment" ADD CONSTRAINT "DesignRequestAttachment_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequestComment" ADD CONSTRAINT "DesignRequestComment_designRequestId_fkey" FOREIGN KEY ("designRequestId") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequestStatusEvent" ADD CONSTRAINT "DesignRequestStatusEvent_designRequestId_fkey" FOREIGN KEY ("designRequestId") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignRequestStatusEvent" ADD CONSTRAINT "DesignRequestStatusEvent_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "DesignBoardColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignRequestStatusEvent" ADD CONSTRAINT "DesignRequestStatusEvent_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "DesignBoardColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
