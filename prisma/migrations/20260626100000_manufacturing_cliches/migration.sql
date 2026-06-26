ALTER TYPE "Role" ADD VALUE 'FACTORY';

CREATE TYPE "ClicheCategory" AS ENUM (
    'ENVIO',
    'COMBO',
    'HAMBURGUESA',
    'PIZZA',
    'LONCHEADO',
    'SOBRES',
    'BOLSAS'
);

CREATE TABLE "Cliche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ClicheCategory" NOT NULL,
    "letter" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliche_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Cliche_category_year_idx" ON "Cliche"("category", "year");
CREATE INDEX "Cliche_name_idx" ON "Cliche"("name");
CREATE INDEX "Cliche_letter_idx" ON "Cliche"("letter");
CREATE INDEX "Cliche_createdAt_idx" ON "Cliche"("createdAt");
