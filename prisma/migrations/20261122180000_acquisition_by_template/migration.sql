-- ADR-007 (22/nov/2026, revision): la atribucion pasa de "landing (producto)
-- -> familia" a "plantilla de n8n -> familia". Asi no hace falta tocar n8n:
-- n8n ya manda la plantilla de la campaña en POST /events/outbound/accepted
-- (endpoint que solo usa n8n; los envios manuales de Fenix van por otro
-- camino y NO cuentan como captacion).
--
-- LeadAcquisitionTouch estaba vacia en produccion (n8n nunca envio
-- `producto`), por eso se puede rehacer sin perder datos.

DELETE FROM "LeadAcquisitionTouch";

ALTER TABLE "LeadAcquisitionTouch" DROP CONSTRAINT "LeadAcquisitionTouch_landingId_fkey";
DROP INDEX "LeadAcquisitionTouch_landingId_occurredAt_idx";
ALTER TABLE "LeadAcquisitionTouch" DROP COLUMN "landingId";
ALTER TABLE "LeadAcquisitionTouch" DROP COLUMN "rawProducto";

DROP TABLE "Landing";

CREATE TABLE "AcquisitionTemplate" (
    "id" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "familyId" TEXT,
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcquisitionTemplate_templateName_key" ON "AcquisitionTemplate"("templateName");
CREATE INDEX "AcquisitionTemplate_familyId_idx" ON "AcquisitionTemplate"("familyId");
ALTER TABLE "AcquisitionTemplate" ADD CONSTRAINT "AcquisitionTemplate_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "InvestmentFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadAcquisitionTouch" ADD COLUMN "templateId" TEXT NOT NULL;
ALTER TABLE "LeadAcquisitionTouch" ADD COLUMN "templateName" TEXT NOT NULL;
ALTER TABLE "LeadAcquisitionTouch" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LIVE';
CREATE INDEX "LeadAcquisitionTouch_templateId_occurredAt_idx" ON "LeadAcquisitionTouch"("templateId", "occurredAt");
ALTER TABLE "LeadAcquisitionTouch" ADD CONSTRAINT "LeadAcquisitionTouch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AcquisitionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Equivalencias plantilla -> familia confirmadas por el usuario (22/nov/2026)
INSERT INTO "AcquisitionTemplate" ("id", "templateName", "familyId", "updatedAt")
SELECT md5('template:' || v.template)::uuid::text, v.template, f."id", CURRENT_TIMESTAMP
FROM (VALUES
  ('cajas_pizza_es',        'LANDING PIZZA'),
  ('cajas_envio_combo_es',  'LANDING COMBO'),
  ('burger_es',             'LANDING HAMBURGUESAS'),
  ('bolsas_es',             'LANDING BOLSAS DE PAPEL'),
  ('generico_es',           'LANDING CAJA ENVÍO'),
  ('caja_asa_es',           'LANDING CAJA ENVÍO'),
  ('papel_antigrasa_es',    'LANDING ANTIGRASA'),
  ('cajas_tarta_es',        'LANDING TARTAS'),
  ('vasos_es',              'LANDING VASOS'),
  ('papel_antigrasa_fra',   'LANDING ANTIGRASA FRANCIA'),
  ('cajas_pizza_fra',       'LANDING PIZZA FRANCIA'),
  ('francia_vasos',         'LANDING VASOS FRANCIA'),
  ('cajas_envio_fra',       'LANDING CAJA ENVÍO FRANCIA'),
  ('caja_asa_fra',          'LANDING CAJA ENVÍO FRANCIA'),
  ('papel_antigrasa_it',    'LANDING ANTIGRASA ITALIA'),
  ('cajas_envio_it',        'LANDING CAJA ENVIO ITALIA'),
  ('caja_asa_it',           'LANDING CAJA ENVIO ITALIA'),
  ('generico_it',           'LANDING COMBO ITALIA'),
  ('pizza_italia',          'LANDING PIZZA ITALIA'),
  ('vasos_italia',          'LANDING VASOS ITALIA'),
  ('caja_envios_suiza',     'LANDING CAJA ENVÍO SUIZA'),
  ('caja_envios_alemania',  'LANDING CAJA ENVÍO SUIZA'),
  ('caja_asa_suiza',        'LANDING CAJA ENVÍO SUIZA'),
  ('caja_asa_alemania',     'LANDING CAJA ENVÍO SUIZA'),
  ('vasos_suiza',           'LANDING VASOS SUIZA'),
  ('vasos_alemania',        'LANDING VASOS SUIZA')
) AS v(template, family)
JOIN "InvestmentFamily" f ON f."name" = v.family
ON CONFLICT ("templateName") DO NOTHING;

-- Historico: reconstruye los toques desde los mensajes que entraron por
-- POST /events/outbound/accepted (n8n). Esos mensajes guardan en rawPayload
-- el body plano de n8n (con "wabaId" y "template") y NO tienen externalId;
-- los envios manuales de Fenix (source = 'outbound-message-service'), los de
-- reglas/reenganche/repeticion (con externalId) y los reconstruidos desde
-- webhooks (con "whatsappMessage") quedan fuera.
INSERT INTO "LeadAcquisitionTouch"
  ("id", "leadId", "templateId", "templateName", "occurredAt", "externalMessageId", "source")
SELECT md5('touch:' || m."id")::uuid::text,
       m."leadId",
       at."id",
       m."templateName",
       COALESCE(m."providerCreateTime", m."occurredAt"),
       m."ycloudMessageId",
       'BACKFILL'
FROM "Message" m
JOIN "AcquisitionTemplate" at ON at."templateName" = m."templateName"
WHERE m."direction" = 'OUTBOUND'
  AND m."externalId" IS NULL
  AND m."rawPayload" ? 'wabaId'
  AND m."rawPayload" ? 'template'
  AND NOT (m."rawPayload" ? 'whatsappMessage')
  AND NOT (m."rawPayload" ? 'source')
ON CONFLICT DO NOTHING;
