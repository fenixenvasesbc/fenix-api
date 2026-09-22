import { CampaignDefinitionType } from '@prisma/client';

export type CampaignTemplateRegistryEntry = {
  templateName: string;
  type: CampaignDefinitionType;
  campaignName: string;
  keyPrefix: string;
};

// Catalogo declarativo: que nombre de plantilla de YCloud alimenta cada tipo
// de campana (Repeticion, Reenganche, y lo que venga despues). Agregar un
// tipo de campana nuevo es agregar una fila aqui -- no copiar un script
// completo como se hacia antes (ver ADR-003).
export const CAMPAIGN_TEMPLATE_REGISTRY: CampaignTemplateRegistryEntry[] = [
  {
    templateName: 'recordatorio_repeticion',
    type: CampaignDefinitionType.REPETITION_REMINDER,
    campaignName: 'Recordatorio de repetición',
    keyPrefix: 'repetition_reminder',
  },
  {
    templateName: 're_enganche',
    type: CampaignDefinitionType.WEEK1_REENGAGEMENT,
    campaignName: 'Reenganche semana 1',
    keyPrefix: 'week1_reengagement',
  },
];
