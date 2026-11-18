import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { LeadCampaignType } from '@prisma/client';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { PrismaService } from 'src/prisma/prisma.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import {
  REPETITION_REMINDER_BUSINESS_WINDOW_PREFIX,
  REPETITION_REMINDER_ROUTING_KEY,
} from './constant';
import { bump, CronRunStats, errorMessage, errorStack, runCronWithSummary } from 'src/common/utils/logging';

@Injectable()
export class RepetitionReminderSchedulerService {
  private readonly logger = new Logger(RepetitionReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitPublisher: RabbitmqService,
  ) {}

  @Cron('15 9 * * 1-5', { timeZone: 'Europe/Madrid' })
  async run(): Promise<void> {
    await runCronWithSummary(this.logger, 'repetition-reminder', (stats) =>
      this.execute(stats),
    );
  }

  private async execute(stats: CronRunStats): Promise<void> {
    const limit = this.resolveBatchLimit();
    const routingKey =
      process.env.RABBITMQ_RK_REPETITION_REMINDER ??
      REPETITION_REMINDER_ROUTING_KEY;

    const reminders = await this.prisma.leadRepetitionReminder.findMany({
      where: {
        dueAt: { lte: new Date() },
        sentAt: null,
        canceledAt: null,
        OR: [
          {
            labelAssignment: {
              label: SYSTEM_LABEL_CODES.REPETICIONES,
              removedAt: null,
            },
          },
          {
            labelAssignmentId: null,
            lead: {
              labelAssignments: {
                some: {
                  label: SYSTEM_LABEL_CODES.REPETICIONES,
                  removedAt: null,
                },
              },
            },
          },
        ],
        lead: {
          accountId: { not: null },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: {
        id: true,
        accountId: true,
        leadId: true,
        dueAt: true,
        lead: {
          select: {
            id: true,
            accountId: true,
          },
        },
      },
    });

    this.logger.log(
      `Found ${reminders.length} due repetition reminders limit=${limit}`,
    );
    stats.found = reminders.length;
    stats.enqueued = 0;
    stats.skipped = 0;
    stats.failed = 0;

    for (const reminder of reminders) {
      const businessWindowKey = this.businessWindowKey(reminder.id);

      try {
        const existingLeadCampaign = await this.prisma.leadCampaign.findUnique({
          where: {
            leadId_type_businessWindowKey: {
              leadId: reminder.leadId,
              type: LeadCampaignType.REPETITION_REMINDER,
              businessWindowKey,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (existingLeadCampaign) {
          this.logger.log(
            `Repetition LeadCampaign already exists reminderId=${reminder.id} leadCampaignId=${existingLeadCampaign.id} status=${existingLeadCampaign.status}`,
          );
          bump(stats, 'skipped');
          continue;
        }

        const externalId = `repetition:reminder:${reminder.id}`;
        const leadCampaign = await this.prisma.leadCampaign.create({
          data: {
            leadId: reminder.leadId,
            accountId: reminder.accountId,
            externalId,
            type: LeadCampaignType.REPETITION_REMINDER,
            status: 'ENQUEUED',
            businessWindowKey,
            scheduledFor: reminder.dueAt,
            enqueuedAt: new Date(),
          },
          select: {
            id: true,
          },
        });

        await this.rabbitPublisher.publish(routingKey, {
          leadCampaignId: leadCampaign.id,
        });

        this.logger.log(
          `Repetition reminder enqueued reminderId=${reminder.id} leadId=${reminder.leadId} leadCampaignId=${leadCampaign.id}`,
        );
        bump(stats, 'enqueued');
      } catch (error) {
        bump(stats, 'failed');
        this.logger.error(
          `Failed to enqueue repetition reminder reminderId=${reminder.id} leadId=${reminder.leadId}: ${errorMessage(error)}`,
          errorStack(error),
        );
      }
    }
  }

  private businessWindowKey(reminderId: string) {
    return `${REPETITION_REMINDER_BUSINESS_WINDOW_PREFIX}:${reminderId}`;
  }

  private resolveBatchLimit() {
    const raw = Number(process.env.REPETITION_REMINDER_SCHEDULER_LIMIT ?? 100);
    if (!Number.isInteger(raw) || raw < 1) return 100;
    return Math.min(raw, 500);
  }
}
