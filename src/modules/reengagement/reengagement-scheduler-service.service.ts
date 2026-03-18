import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';

import { resolveReengagementWindow } from './reengagement-window';
// Ajusta este import a tu implementación real

import { REENGAGEMENT_EXCHANGE, REENGAGEMENT_ROUTING_KEY } from './constant';
import { ReengagementSelectionService } from './reengagement-selection-service.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class ReengagementSchedulerService {
  private readonly logger = new Logger(ReengagementSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly selectionService: ReengagementSelectionService,
    private readonly rabbitPublisher: RabbitmqService,
  ) {}
  //@Cron('0 9 * * 1-5', { timeZone: 'Europe/Madrid' })

  @Cron('0 9 * * 1-5', { timeZone: 'Europe/Madrid' })
  async run(): Promise<void> {
    const window = resolveReengagementWindow(new Date());
    this.logger.log(
      'Bussiness window for reengagement: ' + window?.businessWindowKey,
    );
    if (!window) {
      this.logger.log('No business window today, skipping reengagement job');
      return;
    }

    const leads = await this.selectionService.findEligibleLeads(
      window.start,
      window.end,
    );

    this.logger.log(
      `Found ${leads.length} eligible leads for ${window.businessWindowKey}`,
    );

    for (const lead of leads) {
      try {
        const leadCampaign = await this.prisma.leadCampaign.upsert({
          where: {
            leadId_type_businessWindowKey: {
              leadId: lead.id,
              type: 'WEEK1_REENGAGEMENT',
              businessWindowKey: window.businessWindowKey,
            },
          },
          update: {},
          create: {
            leadId: lead.id,
            accountId: lead.accountId!,
            type: 'WEEK1_REENGAGEMENT',
            status: 'ENQUEUED',
            businessWindowKey: window.businessWindowKey,
            sourceTemplateName: lead.firstOutboundTemplateName,
            scheduledFor: new Date(),
            enqueuedAt: new Date(),
          },
          select: {
            id: true,
          },
        });

        await this.rabbitPublisher.publish(
          process.env.RABBITMQ_RK_REENGAGEMENT!,
          { leadCampaignId: leadCampaign.id },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown scheduler error';
        this.logger.error(
          `Failed to enqueue reengagement for leadId=${lead.id}: ${message}`,
        );
      }
    }
  }
}
