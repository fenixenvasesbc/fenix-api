-- Pedido explicito del usuario, 26/oct/2026: indicador de "comentario
-- nuevo" por usuario en la card de un boceto (ver DesignRequestCommentView
-- en schema.prisma / DesignBoardService.listRequests()+getRequestDetail()).
CREATE TABLE "DesignRequestCommentView" (
    "id" TEXT NOT NULL,
    "designRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRequestCommentView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesignRequestCommentView_designRequestId_userId_key" ON "DesignRequestCommentView"("designRequestId", "userId");

CREATE INDEX "DesignRequestCommentView_userId_idx" ON "DesignRequestCommentView"("userId");

ALTER TABLE "DesignRequestCommentView" ADD CONSTRAINT "DesignRequestCommentView_designRequestId_fkey" FOREIGN KEY ("designRequestId") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
