import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { LeadCampaignType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import {
  LABEL_MESSAGE_RULE_BUSINESS_WINDOW_PREFIX,
  LABEL_MESSAGE_RULE_ROUTING_KEY,
} from './constant';

// Job unico generico de ADR-002: recorre las reglas activas de
// LabelMessageRule y, por cada una, busca las asignaciones de esa etiqueta
// que ya llevan >= triggerAfterDays sin haber sido removidas, y aun no
// tienen un LeadCampaign(type=LABEL_RULE) para esa combinacion regla+
// asignacion (dedupe: si la etiqueta se quita y se vuelve a asignar despues,
// cuenta como una asignacion nueva y puede volver a disparar).
@Injectable()
export class LabelMessageRuleSchedulerService {
  private readonly logger = new Logger(LabelMessageRuleSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitPublisher: RabbitmqService,
  ) {}

  @Cron('30 9 * * *', { timeZone: 'Europe/Madrid' })
  async run(): Promise<void> {
    const limit = this.resolveBatchLimit();
    const routingKey =
      process.env.RABBITMQ_RK_LABEL_MESSAGE_RULE ??
      LABEL_MESSAGE_RULE_ROUTING_KEY;

    const rules = await this.prisma.labelMessageRule.findMany({
      where: { active: true },
    });

    this.logger.log(`Found ${rules.length} active label message rules`);

    for (const rule of rules) {
      const threshold = new Date(
        Date.now() - rule.triggerAfterDays * 24 * 60 * 60 * 1000,
      );

      const assignments = await this.prisma.leadLabelAssignment.findMany({
        where: {
          label: rule.labelCode,
          removedAt: null,
          assignedAt: { lte: threshold },
          lead: { accountId: { not: null } },
        },
        orderBy: { assignedAt: 'asc' },
        take: limit,
        select: {
          id: true,
          leadId: true,
          accountId: true,
        },
      });

      this.logger.log(
        `Rule "${rule.name}" (${rule.id}) matched ${assignments.length} label assignments`,
      );

      for (const assignment of assignments) {
        const businessWindowKey = this.businessWindowKey(
          rule.id,
          assignment.id,
        );

        try {
          const existingLeadCampaign = await this.prisma.leadCampaign.findUnique({
            where: {
              leadId_type_businessWindowKey: {
                leadId: assignment.leadId,
                type: LeadCampaignType.LABEL_RULE,
                businessWindowKey,
              },
            },
            select: { id: true, status: true },
          });

          if (existingLeadCampaign) {
            continue;
          }

          const externalId = `label-rule:${rule.id}:${assignment.id}`;
          const leadCampaign = await this.prisma.leadCampaign.create({
            data: {
              leadId: assignment.leadId,
              accountId: assignment.accountId,
              externalId,
              type: LeadCampaignType.LABEL_RULE,
              status: 'ENQUEUED',
              businessWindowKey,
              scheduledFor: new Date(),
              enqueuedAt: new Date(),
            },
            select: { id: true },
          });

          await this.rabbitPublisher.publish(routingKey, {
            leadCampaignId: leadCampaign.id,
          });

          this.logger.log(
            `Label message rule enqueued ruleId=${rule.id} assignmentId=${assignment.id} leadId=${assignment.leadId} leadCampaignId=${leadCampaign.id}`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown scheduler error';

          this.logger.error(
            `Failed to enqueue label message rule ruleId=${rule.id} assignmentId=${assignment.id}: ${message}`,
          );
        }
      }
    }
  }

  private businessWindowKey(ruleId: string, assignmentId: string) {
    return `${LABEL_MESSAGE_RULE_BUSINESS_WINDOW_PREFIX}:${ruleId}:${assignmentId}`;
  }

  private resolveBatchLimit() {
    const raw = Number(process.env.LABEL_MESSAGE_RULE_SCHEDULER_LIMIT ?? 200);
    if (!Number.isInteger(raw) || raw < 1) return 200;
    return Math.min(raw, 1000);
  }
}
