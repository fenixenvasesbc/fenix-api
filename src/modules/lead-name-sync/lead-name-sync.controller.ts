import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RunYcloudBackfillDto } from './dto/run-ycloud-backfill.dto';
import { LeadNameSyncService } from './lead-name-sync.service';

// Sincronizacion manual de nombres de lead contra la agenda de YCloud
// (WhatsApp Business), disparable desde Configuracion > Reglas de mensajes
// (misma pestaña). Solo SUPPORT -- mismo patron/justificacion que
// LabelMessageRulesController: SUPPORT hereda el resto de permisos de ADMIN
// via ROLE_INHERITANCE (ver RolesGuard), pero esta pantalla puntual queda
// reservada a SUPPORT a proposito.
@Controller('lead-name-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPPORT)
export class LeadNameSyncController {
  constructor(private readonly leadNameSyncService: LeadNameSyncService) {}

  @Post('ycloud-backfill')
  async runYcloudBackfill(@Body() body: RunYcloudBackfillDto) {
    const summary = await this.leadNameSyncService.runYcloudBackfill({
      apply: body.apply ?? false,
      accountId: body.accountId ?? null,
      limit: body.limit ?? null,
      concurrency: body.concurrency ?? 3,
      delayMs: body.delayMs ?? 250,
    });

    return { data: summary };
  }
}
