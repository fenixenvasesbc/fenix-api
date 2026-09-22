import { IsObject, IsOptional, IsString } from 'class-validator';

// preferLanguage: { "recordatorio_repeticion": "es" } -- cuando YCloud tiene
// mas de una variante de idioma para el mismo nombre de plantilla (colision
// es/es_ES), indica cual usar. Opcional: sin esto, una colision detectada
// queda sin aplicar y marcada para revision (ver CampaignTemplateSyncService).
export class SyncCampaignTemplatesDto {
  @IsOptional()
  @IsObject()
  preferLanguage?: Record<string, string>;
}
