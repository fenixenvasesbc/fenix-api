import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ExportLeadsQueryDto } from './dto/lead.dto';
import { LeadsService } from './leads.service';

/**
 * Endpoint de exportación de leads para integraciones externas (n8n, etc.).
 * Se separa del LeadsController (que usa JwtAuthGuard + RolesGuard) porque
 * los guards de un controlador se apilan con los de sus métodos: si
 * hubiéramos puesto @UseGuards(ApiKeyGuard) en un método de LeadsController,
 * la petición seguiría exigiendo también el JWT del guard de clase.
 * Aquí solo exigimos la API key (misma que ya usa n8n en /events, header
 * "X-API-Key" contra la variable de entorno N8N_API_KEY).
 */
@Controller('leads')
@UseGuards(ApiKeyGuard)
export class LeadsExportController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('export')
  async exportLeads(@Query() query: ExportLeadsQueryDto) {
    return this.leadsService.exportLeads({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
      accountId: query.accountId,
      label: query.label,
    });
  }
}
