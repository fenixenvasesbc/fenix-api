import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadLabel, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';

type ListLeadsInput = {
  accountId: string;
  label?: LeadLabel;
  search?: string | null;
  limit: number;
  beforeLeadId?: string | null;
  labelChangedOrder?: 'asc' | 'desc';
};

type SetLabelInput = {
  accountId: string;
  leadId: string;
  label: LeadLabel;
  changedByUserId?: string | null;
  reminderDays?: number;
};

const DEFAULT_REPETITION_REMINDER_DAYS = 90;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async listByAccount(input: ListLeadsInput) {
    const {
      accountId,
      label,
      search,
      limit,
      beforeLeadId,
      labelChangedOrder = 'desc',
    } = input;
    const sortByLabelChangedAt = Boolean(label);
    const sortDirection = sortByLabelChangedAt
      ? labelChangedOrder
      : ('desc' as const);

    const baseWhere: Prisma.LeadWhereInput = {
      accountId,
      ...(label
        ? {
            currentLabel: label,
            currentLabelChangedAt: { not: null },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phoneE164: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              {
                whatsappUsername: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const beforeLead = beforeLeadId
      ? await this.prisma.lead.findFirst({
          where: {
            ...baseWhere,
            id: beforeLeadId,
          },
          select: {
            id: true,
            updatedAt: true,
            currentLabelChangedAt: true,
          },
        })
      : null;

    if (beforeLeadId && !beforeLead) {
      throw new NotFoundException('Lead cursor not found for these filters');
    }

    const cursorDate = beforeLead
      ? sortByLabelChangedAt
        ? beforeLead.currentLabelChangedAt
        : beforeLead.updatedAt
      : null;

    if (beforeLead && !cursorDate) {
      throw new NotFoundException('Lead cursor has no sortable date');
    }

    const dateField = sortByLabelChangedAt
      ? 'currentLabelChangedAt'
      : 'updatedAt';
    const dateComparator =
      sortDirection === 'desc' ? { lt: cursorDate! } : { gt: cursorDate! };
    const idComparator =
      sortDirection === 'desc'
        ? { lt: beforeLead?.id }
        : { gt: beforeLead?.id };

    const leads = await this.prisma.lead.findMany({
      where: beforeLead
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  {
                    [dateField]: dateComparator,
                  },
                  {
                    [dateField]: cursorDate,
                    id: idComparator,
                  },
                ],
              },
            ],
          }
        : baseWhere,
      orderBy: sortByLabelChangedAt
        ? [{ currentLabelChangedAt: sortDirection }, { id: sortDirection }]
        : [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: this.leadSelect(),
    });

    const hasMore = leads.length > limit;
    const data = hasMore ? leads.slice(0, limit) : leads;

    return {
      data,
      pageInfo: {
        hasMore,
        nextBefore: hasMore ? (data.at(-1)?.id ?? null) : null,
      },
    };
  }

  async setLabel(input: SetLabelInput) {
    const { accountId, leadId, label, changedByUserId, reminderDays } = input;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        accountId: true,
        currentLabel: true,
        repetitionReminderDays: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    if (!lead.accountId) {
      throw new BadRequestException('Lead has no accountId');
    }

    if (lead.currentLabel === label) {
      return this.getById(accountId, leadId);
    }

    const markedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const previousRepetition = await tx.leadLabelHistory.findFirst({
        where: {
          leadId,
          toLabel: LeadLabel.REPETICIONES,
        },
        orderBy: { changedAt: 'desc' },
        select: { changedAt: true },
      });

      const history = await tx.leadLabelHistory.create({
        data: {
          accountId,
          leadId,
          fromLabel: lead.currentLabel,
          toLabel: label,
          changedAt: markedAt,
          changedByUserId: changedByUserId ?? null,
        },
      });

      await tx.leadRepetitionReminder.updateMany({
        where: {
          leadId,
          sentAt: null,
          canceledAt: null,
        },
        data: {
          canceledAt: markedAt,
        },
      });

      const repetitionPlan =
        label === LeadLabel.REPETICIONES
          ? this.buildRepetitionPlan({
              markedAt,
              previousRepetitionAt: previousRepetition?.changedAt ?? null,
              currentReminderDays: lead.repetitionReminderDays,
              overrideReminderDays: reminderDays,
            })
          : null;

      let reminderId: string | null = null;

      if (repetitionPlan) {
        const reminder = await tx.leadRepetitionReminder.create({
          data: {
            accountId,
            leadId,
            labelHistoryId: history.id,
            markedAt,
            dueAt: repetitionPlan.dueAt,
            reminderDays: repetitionPlan.reminderDays,
          },
          select: { id: true },
        });

        reminderId = reminder.id;
      }

      const updatedLead = await tx.lead.update({
        where: { id: leadId },
        data: {
          currentLabel: label,
          currentLabelChangedAt: markedAt,
          ...(repetitionPlan
            ? {
                repetitionReminderDays: repetitionPlan.reminderDays,
                nextRepetitionReminderAt: repetitionPlan.dueAt,
              }
            : {
                nextRepetitionReminderAt: null,
              }),
        },
        select: this.leadSelect(),
      });

      return {
        lead: updatedLead,
        labelHistoryId: history.id,
        repetitionReminderId: reminderId,
        nextRepetitionReminderAt: repetitionPlan?.dueAt ?? null,
        repetitionReminderDays: repetitionPlan?.reminderDays ?? null,
      };
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId,
      leadId,
      payload: {
        reason: 'lead_label_changed',
        label,
        labelHistoryId: result.labelHistoryId,
        repetitionReminderId: result.repetitionReminderId,
        nextRepetitionReminderAt:
          result.nextRepetitionReminderAt?.toISOString() ?? null,
        repetitionReminderDays: result.repetitionReminderDays,
      },
    });

    return result;
  }

  async getHistory(accountId: string, leadId: string) {
    await this.assertLeadExists(accountId, leadId);

    return this.prisma.leadLabelHistory.findMany({
      where: { accountId, leadId },
      orderBy: { changedAt: 'desc' },
      take: 100,
    });
  }

  async listDueRepetitionReminders(accountId: string, limit: number) {
    return this.prisma.leadRepetitionReminder.findMany({
      where: {
        accountId,
        dueAt: {
          lte: new Date(),
        },
        sentAt: null,
        canceledAt: null,
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      include: {
        lead: {
          select: this.leadSelect(),
        },
      },
    });
  }

  async markRepetitionReminderSent(accountId: string, reminderId: string) {
    const reminder = await this.prisma.leadRepetitionReminder.findFirst({
      where: {
        id: reminderId,
        accountId,
      },
      select: {
        id: true,
        leadId: true,
        sentAt: true,
      },
    });

    if (!reminder) {
      throw new NotFoundException('Repetition reminder not found');
    }

    const sentAt = reminder.sentAt ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const updatedReminder = await tx.leadRepetitionReminder.update({
        where: { id: reminder.id },
        data: {
          sentAt,
        },
      });

      await tx.lead.updateMany({
        where: {
          id: reminder.leadId,
          accountId,
          nextRepetitionReminderAt: updatedReminder.dueAt,
        },
        data: {
          nextRepetitionReminderAt: null,
        },
      });

      return updatedReminder;
    });
  }

  private async getById(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: this.leadSelect(),
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    return {
      lead,
      labelHistoryId: null,
      repetitionReminderId: null,
      nextRepetitionReminderAt: lead.nextRepetitionReminderAt,
      repetitionReminderDays: lead.repetitionReminderDays,
    };
  }

  private async assertLeadExists(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: { id: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }
  }

  private buildRepetitionPlan(input: {
    markedAt: Date;
    previousRepetitionAt: Date | null;
    currentReminderDays: number | null;
    overrideReminderDays?: number;
  }) {
    const reminderDays =
      input.overrideReminderDays ??
      (input.previousRepetitionAt
        ? this.daysBetween(input.previousRepetitionAt, input.markedAt)
        : (input.currentReminderDays ?? DEFAULT_REPETITION_REMINDER_DAYS));

    return {
      reminderDays,
      dueAt: this.nextWeekday(this.addDays(input.markedAt, reminderDays)),
    };
  }

  private daysBetween(from: Date, to: Date) {
    const diffMs = to.getTime() - from.getTime();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

    return Math.max(1, diffDays);
  }

  private addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private nextWeekday(date: Date) {
    const result = new Date(date);
    const day = result.getUTCDay();

    if (day === 6) {
      result.setUTCDate(result.getUTCDate() + 2);
    }

    if (day === 0) {
      result.setUTCDate(result.getUTCDate() + 1);
    }

    return result;
  }

  private leadSelect() {
    return {
      id: true,
      accountId: true,
      name: true,
      phoneE164: true,
      email: true,
      status: true,
      currentLabel: true,
      currentLabelChangedAt: true,
      repetitionReminderDays: true,
      nextRepetitionReminderAt: true,
      preferredLanguage: true,
      whatsappUserId: true,
      whatsappParentUserId: true,
      whatsappUsername: true,
      firstOutboundAt: true,
      firstInboundAt: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      respondedAt: true,
      lastMessageAt: true,
      sourceTemplateName: true,
      firstOutboundTemplateName: true,
      reengagementSentAt: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.LeadSelect;
  }
}
