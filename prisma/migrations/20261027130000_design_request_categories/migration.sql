-- Pedido explicito del usuario, 27/oct/2026: categorias para solicitudes
-- de boceto (una o varias por solicitud), APARTE de las labels de lead
-- (LeadLabelDefinition) -- catalogo global configurable solo por ADMIN
-- desde Configuracion > Categorias (ver DesignRequestCategoriesService).

CREATE TABLE "DesignRequestCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignRequestCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesignRequestCategory_name_key" ON "DesignRequestCategory"("name");

CREATE TABLE "DesignRequestCategoryAssignment" (
    "id" TEXT NOT NULL,
    "designRequestId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRequestCategoryAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesignRequestCategoryAssignment_designRequestId_categoryId_key" ON "DesignRequestCategoryAssignment"("designRequestId", "categoryId");

CREATE INDEX "DesignRequestCategoryAssignment_categoryId_idx" ON "DesignRequestCategoryAssignment"("categoryId");

ALTER TABLE "DesignRequestCategoryAssignment" ADD CONSTRAINT "DesignRequestCategoryAssignment_designRequestId_fkey" FOREIGN KEY ("designRequestId") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignRequestCategoryAssignment" ADD CONSTRAINT "DesignRequestCategoryAssignment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DesignRequestCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
