import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { LeadsService } from '../leads/leads.service';

// ADR-004 Submodulo 1: recorre las solicitudes de boceto que ya vencieron
// (dueAt < now) y todavia no llegaron a "Terminado"/"Aprobados", y les
// aplica la etiqueta BOCETOS_ATRASADOS al lead una unica vez (dedupe via
// overdueLabelAppliedAt, igual de espiritu que el dedupe por
// LeadCampaign(type=LABEL_RULE) de LabelMessageRuleSchedulerService).
@Injectable()
export class DesignRequestSlaSchedulerService {
  private readonly logger = new Logger(DesignRequestSlaSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
  ) {}

  @Cron('15 * * * *', { timeZone: 'Europe/Madrid' })
  async run(): Promise<void> {
    const now = new Date();

    const overdue = await this.prisma.designRequest.findMany({
      where: {
        dueAt: { lt: now },
        completedAt: null,
        approvedAt: null,
        overdueLabelAppliedAt: null,
        // ADR-004 Submodulo 5: una solicitud pausada no puede vencerse --
        // el plazo esta congelado hasta que DESIGNER_MANAGER la reanude.
        pausedAt: null,
      },
      select: { id: true, accountId: true, leadId: true },
      take: 500,
    });

    if (overdue.length === 0) return;

    this.logger.log(`Found ${overdue.length} overdue design requests`);

    for (const request of overdue) {
      try {
        await this.leadsService.setLabel({
          accountId: request.accountId,
          leadId: request.leadId,
          label: SYSTEM_LABEL_CODES.BOCETOS_ATRASADOS,
        });

        await this.prisma.designRequest.update({
          where: { id: request.id },
          data: { overdueLabelAppliedAt: now },
        });
      } catch (error) {
        this.logger.error(
          `Failed to mark design request ${request.id} as overdue`,
          error as Error,
        );
      }
    }
  }
}
