-- Agrega los estados IN_APPEAL y ARCHIVED que YCloud/Meta puede reportar
-- en el webhook whatsapp.template.reviewed (junto con REJECTED, APPROVED,
-- PAUSED, DISABLED) para AccountGlobalTemplateStatus. Antes de este cambio
-- esos dos valores no existian en el enum y TemplateStatusService los
-- ignoraba (a proposito, para no pisar un estado conocido con uno no
-- reconocido), dejando el estado desactualizado ante esas transiciones.

ALTER TYPE "AccountGlobalTemplateStatus" ADD VALUE 'IN_APPEAL';
ALTER TYPE "AccountGlobalTemplateStatus" ADD VALUE 'ARCHIVED';
