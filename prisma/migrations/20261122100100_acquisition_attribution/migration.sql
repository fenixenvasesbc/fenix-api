-- ADR-007 (22/nov/2026): atribucion de leads captados por n8n a familias de
-- inversion, para el ROI semanal de campañas (Dashboard > Campañas / ROI).

CREATE TABLE "InvestmentFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" "DesignRequestCountry" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvestmentFamily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvestmentFamily_name_key" ON "InvestmentFamily"("name");
CREATE INDEX "InvestmentFamily_active_sortOrder_idx" ON "InvestmentFamily"("active", "sortOrder");

CREATE TABLE "Landing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "familyId" TEXT,
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Landing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Landing_slug_key" ON "Landing"("slug");
CREATE INDEX "Landing_familyId_idx" ON "Landing"("familyId");
ALTER TABLE "Landing" ADD CONSTRAINT "Landing_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "InvestmentFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadAcquisitionTouch" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "rawProducto" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadAcquisitionTouch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadAcquisitionTouch_externalMessageId_key" ON "LeadAcquisitionTouch"("externalMessageId");
CREATE INDEX "LeadAcquisitionTouch_landingId_occurredAt_idx" ON "LeadAcquisitionTouch"("landingId", "occurredAt");
CREATE INDEX "LeadAcquisitionTouch_leadId_occurredAt_idx" ON "LeadAcquisitionTouch"("leadId", "occurredAt");
CREATE INDEX "LeadAcquisitionTouch_occurredAt_idx" ON "LeadAcquisitionTouch"("occurredAt");
ALTER TABLE "LeadAcquisitionTouch" ADD CONSTRAINT "LeadAcquisitionTouch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAcquisitionTouch" ADD CONSTRAINT "LeadAcquisitionTouch_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FamilyWeeklySpend" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilyWeeklySpend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyWeeklySpend_familyId_weekStart_key" ON "FamilyWeeklySpend"("familyId", "weekStart");
CREATE INDEX "FamilyWeeklySpend_weekStart_idx" ON "FamilyWeeklySpend"("weekStart");
ALTER TABLE "FamilyWeeklySpend" ADD CONSTRAINT "FamilyWeeklySpend_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "InvestmentFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed del catalogo inicial (equivalencias confirmadas por el usuario,
-- 22/nov/2026). Editable despues desde Configuracion > Campañas y familias.
INSERT INTO "InvestmentFamily" ("id", "name", "country", "sortOrder", "updatedAt") VALUES
  (md5('family:LANDING CAJA ENVÍO')::uuid::text,          'LANDING CAJA ENVÍO',          'ES', 10,  CURRENT_TIMESTAMP),
  (md5('family:LANDING PIZZA')::uuid::text,               'LANDING PIZZA',               'ES', 20,  CURRENT_TIMESTAMP),
  (md5('family:LANDING COMBO')::uuid::text,               'LANDING COMBO',               'ES', 30,  CURRENT_TIMESTAMP),
  (md5('family:LANDING BOLSAS DE PAPEL')::uuid::text,     'LANDING BOLSAS DE PAPEL',     'ES', 40,  CURRENT_TIMESTAMP),
  (md5('family:LANDING HAMBURGUESAS')::uuid::text,        'LANDING HAMBURGUESAS',        'ES', 50,  CURRENT_TIMESTAMP),
  (md5('family:LANDING ANTIGRASA')::uuid::text,           'LANDING ANTIGRASA',           'ES', 60,  CURRENT_TIMESTAMP),
  (md5('family:LANDING VASOS')::uuid::text,               'LANDING VASOS',               'ES', 70,  CURRENT_TIMESTAMP),
  (md5('family:LANDING TARTAS')::uuid::text,              'LANDING TARTAS',              'ES', 80,  CURRENT_TIMESTAMP),
  (md5('family:LANDING PIZZA FRANCIA')::uuid::text,       'LANDING PIZZA FRANCIA',       'FR', 110, CURRENT_TIMESTAMP),
  (md5('family:LANDING ANTIGRASA FRANCIA')::uuid::text,   'LANDING ANTIGRASA FRANCIA',   'FR', 120, CURRENT_TIMESTAMP),
  (md5('family:LANDING VASOS FRANCIA')::uuid::text,       'LANDING VASOS FRANCIA',       'FR', 130, CURRENT_TIMESTAMP),
  (md5('family:LANDING CAJA ENVÍO FRANCIA')::uuid::text,  'LANDING CAJA ENVÍO FRANCIA',  'FR', 140, CURRENT_TIMESTAMP),
  (md5('family:LANDING ANTIGRASA ITALIA')::uuid::text,    'LANDING ANTIGRASA ITALIA',    'IT', 210, CURRENT_TIMESTAMP),
  (md5('family:LANDING CAJA ENVIO ITALIA')::uuid::text,   'LANDING CAJA ENVIO ITALIA',   'IT', 220, CURRENT_TIMESTAMP),
  (md5('family:LANDING VASOS ITALIA')::uuid::text,        'LANDING VASOS ITALIA',        'IT', 230, CURRENT_TIMESTAMP),
  (md5('family:LANDING COMBO ITALIA')::uuid::text,        'LANDING COMBO ITALIA',        'IT', 240, CURRENT_TIMESTAMP),
  (md5('family:LANDING PIZZA ITALIA')::uuid::text,        'LANDING PIZZA ITALIA',        'IT', 250, CURRENT_TIMESTAMP),
  (md5('family:LANDING CAJA ENVÍO SUIZA')::uuid::text,    'LANDING CAJA ENVÍO SUIZA',    'CH', 310, CURRENT_TIMESTAMP),
  (md5('family:LANDING VASOS SUIZA')::uuid::text,         'LANDING VASOS SUIZA',         'CH', 320, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "Landing" ("id", "slug", "familyId", "updatedAt")
SELECT md5('landing:' || v.slug)::uuid::text, v.slug, f."id", CURRENT_TIMESTAMP
FROM (VALUES
  ('/caja-personalizada',      'LANDING CAJA ENVÍO'),
  ('/caja-envio-con-asa',      'LANDING CAJA ENVÍO'),
  ('/landing-pizza',           'LANDING PIZZA'),
  ('/landing-combo',           'LANDING COMBO'),
  ('/landing-bolsas-papel',    'LANDING BOLSAS DE PAPEL'),
  ('/landing-burguer',         'LANDING HAMBURGUESAS'),
  ('/antigrasa',               'LANDING ANTIGRASA'),
  ('/vasos-personalizados',    'LANDING VASOS'),
  ('/tartas',                  'LANDING TARTAS'),
  ('/francia-pizza',           'LANDING PIZZA FRANCIA'),
  ('/antigrasa-francia',       'LANDING ANTIGRASA FRANCIA'),
  ('/francia-vasos',           'LANDING VASOS FRANCIA'),
  ('/envio-francia',           'LANDING CAJA ENVÍO FRANCIA'),
  ('/italia-antigrasa',        'LANDING ANTIGRASA ITALIA'),
  ('/caja-envios-italia',      'LANDING CAJA ENVIO ITALIA'),
  ('/vasos-italia',            'LANDING VASOS ITALIA'),
  ('/italia-combo',            'LANDING COMBO ITALIA'),
  ('/pizza.italia',            'LANDING PIZZA ITALIA'),
  ('/caja-envio-suiza-ingles', 'LANDING CAJA ENVÍO SUIZA'),
  ('/caja-envio-suiza-aleman', 'LANDING CAJA ENVÍO SUIZA'),
  ('/vasos-suiza-ingles',      'LANDING VASOS SUIZA'),
  ('/vasos-suiza-aleman',      'LANDING VASOS SUIZA')
) AS v(slug, family)
JOIN "InvestmentFamily" f ON f."name" = v.family
ON CONFLICT ("slug") DO NOTHING;
