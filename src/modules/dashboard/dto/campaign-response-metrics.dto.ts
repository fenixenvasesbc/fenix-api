import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { LeadCampaignType } from '@prisma/client';
import { DateRangeDto } from './first-message-metrics.dto';

// ADR-006: metrica de tasa de respuesta de LeadCampaign (reenganche,
// repeticion, reglas de etiqueta -- y cualquier tipo futuro, ya que todas
// se apoyan en respondedAt/sentAt de la misma tabla).
export class CampaignResponseMetricsDto extends DateRangeDto {
  @IsOptional()
  @IsEnum(LeadCampaignType)
  type?: LeadCampaignType;

  // Solo ADMIN/SUPPORT puede usarlo para ver una cuenta puntual; SALES/
  // SALES_MANAGER siempre quedan limitados a la suya (ver DashboardService).
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
