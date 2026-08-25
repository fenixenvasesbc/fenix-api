import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadLabel, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { normalizeLeadName, withLeadDisplayName } from 'src/common/utils/lead-name';
import { ChatEventsService } from '../chat-events/chat-events.service';

type ListLeadsInput = {
  accountId: string;
  label?: LeadLabel;
  search?: string | null;
  limit: number;
  beforeLeadId?: string | null;
  labelChangedOrder?: 'asc' | 'desc';
  labelStaleDays?: number;
};

type SetLabelInput = {
  accountId: string;
  leadId: string;
  label: LeadLabel;
  changedByUserId?: string | null;
  reminderDays?: number;
};

type RemoveLabelInput = {
  accountId: string;
  leadId: string;
  label: LeadLabel;
  changedByUserId?: string | null;
  reason?: string | null;
};

type EnsureLeadByPhoneInput = {
  accountId: string;
  countryCode: string;
  phoneNumber: string;
  name?: string | null;
};

type ExportLeadsInput = {
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
  accountId?: string;
  label?: LeadLabel;
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
      labelStaleDays,
    } = input;
    const staleCutoff =
      label && labelStaleDays
        ? this.addDays(new Date(), -labelStaleDays)
        : null;

    if (label) {
      return this.listByAccountAndActiveLabel({
        accountId,
        label,
        search,
        limit,
        beforeLeadId,
        labelChangedOrder,
        staleCutoff,
      });
    }

    const baseWhere: Prisma.LeadWhereInput = {
      accountId,
      ...(search
        ? {
            OR: [
              {
                whatsappContactName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              { ycloudNickname: { contains: search, mode: 'insensitive' } },
              {
                whatsappProfileName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
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
          },
        })
      : null;

    if (beforeLeadId && !beforeLead) {
      throw new NotFoundException('Lead cursor not found for these filters');
    }

    const cursorDate = beforeLead?.updatedAt;

    const leads = await this.prisma.lead.findMany({
      where: beforeLead
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  {
                    updatedAt: { lt: cursorDate },
                  },
                  {
                    updatedAt: cursorDate,
                    id: { lt: beforeLead.id },
                  },
                ],
              },
            ],
          }
        : baseWhere,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: this.leadSelect(),
    });

    const hasMore = leads.length > limit;
    const page = hasMore ? leads.slice(0, limit) : leads;
    const data = page.map(withLeadDisplayName);

    return {
      data,
      pageInfo: {
        hasMore,
        nextBefore: hasMore ? (data.at(-1)?.id ?? null) : null,
      },
    };
  }

  private async listByAccountAndActiveLabel(input: {
    accountId: string;
    label: LeadLabel;
    search?: string | null;
    limit: number;
    beforeLeadId?: string | null;
    labelChangedOrder?: 'asc' | 'desc';
    staleCutoff?: Date | null;
  }) {
    const sortDirection = input.labelChangedOrder ?? 'desc';
    const leadWhere = this.leadSearchWhere(input.accountId, input.search);
    const assignmentWhere: Prisma.LeadLabelAssignmentWhereInput = {
      accountId: input.accountId,
      label: input.label,
      removedAt: null,
      ...(input.staleCutoff ? { assignedAt: { lte: input.staleCutoff } } : {}),
      lead: leadWhere,
    };

    const beforeAssignment = input.beforeLeadId
      ? await this.prisma.leadLabelAssignment.findFirst({
          where: {
            ...assignmentWhere,
            leadId: input.beforeLeadId,
          },
          select: {
            id: true,
            assignedAt: true,
            leadId: true,
          },
        })
      : null;

    if (input.beforeLeadId && !beforeAssignment) {
      throw new NotFoundException('Lead cursor not found for these filters');
    }

    const assignments = await this.prisma.leadLabelAssignment.findMany({
      where: beforeAssignment
        ? {
            AND: [
              assignmentWhere,
              {
                OR: [
                  {
                    assignedAt:
                      sortDirection === 'desc'
                        ? { lt: beforeAssignment.assignedAt }
                        : { gt: beforeAssignment.assignedAt },
                  },
                  {
                    assignedAt: beforeAssignment.assignedAt,
                    id:
                      sortDirection === 'desc'
                        ? { lt: beforeAssignment.id }
                        : { gt: beforeAssignment.id },
                  },
                ],
              },
            ],
          }
        : assignmentWhere,
      orderBy: [{ assignedAt: sortDirection }, { id: sortDirection }],
      take: input.limit + 1,
      include: {
        lead: {
          select: this.leadSelect(),
        },
      },
    });

    const hasMore = assignments.length > input.limit;
    const page = hasMore ? assignments.slice(0, input.limit) : assignments;
    const data = page.map((assignment) =>
      withLeadDisplayName({
        ...assignment.lead,
        currentLabel: assignment.lead.currentLabel ?? assignment.label,
        currentLabelChangedAt:
          assignment.lead.currentLabel === assignment.label
            ? assignment.lead.currentLabelChangedAt
            : assignment.assignedAt,
      }),
    );

    return {
      data,
      pageInfo: {
        hasMore,
        nextBefore: hasMore ? (data.at(-1)?.id ?? null) : null,
      },
    };
  }

  async ensureByPhone(input: EnsureLeadByPhoneInput) {
    const phoneE164 = this.toE164(input.countryCode, input.phoneNumber);
    const normalizedName = normalizeLeadName(input.name);

    const lead = await this.prisma.lead.upsert({
      where: {
        accountId_phoneE164: {
          accountId: input.accountId,
          phoneE164,
        },
      },
      create: {
        accountId: input.accountId,
        phoneE164,
        name: normalizedName ?? undefined,
        status: LeadStatus.NEW,
      },
      update: {},
      select: this.leadSelect(),
    });

    return withLeadDisplayName(lead);
  }

  async setLabel(input: SetLabelInput) {
    const { accountId, leadId, label, changedByUserId, reminderDays } = input;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        accountId: true,
        currentLabel: true,
        currentLabelChangedAt: true,
        repetitionReminderDays: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    if (!lead.accountId) {
      throw new BadRequestException('Lead has no accountId');
    }

    const markedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const existingAssignment = await tx.leadLabelAssignment.findFirst({
        where: {
          leadId,
          accountId,
          label,
          removedAt: null,
        },
        select: {
          id: true,
          assignedAt: true,
        },
      });

      const assignment =
        existingAssignment ??
        (await tx.leadLabelAssignment.create({
          data: {
            accountId,
            leadId,
            label,
            assignedAt: markedAt,
            assignedByUserId: changedByUserId ?? null,
          },
          select: {
            id: true,
            assignedAt: true,
          },
        }));

      const previousRepetition = await tx.leadLabelAssignment.findFirst({
        where: {
          leadId,
          label: LeadLabel.REPETICIONES,
          id: { not: assignment.id },
        },
        orderBy: { assignedAt: 'desc' },
        select: { assignedAt: true },
      });

      const history = existingAssignment
        ? null
        : await tx.leadLabelHistory.create({
            data: {
              accountId,
              leadId,
              fromLabel: lead.currentLabel,
              toLabel: label,
              changedAt: assignment.assignedAt,
              changedByUserId: changedByUserId ?? null,
            },
          });

      const repetitionPlan =
        !existingAssignment && label === LeadLabel.REPETICIONES
          ? this.buildRepetitionPlan({
              markedAt: assignment.assignedAt,
              previousRepetitionAt: previousRepetition?.assignedAt ?? null,
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
            labelHistoryId: history?.id ?? null,
            labelAssignmentId: assignment.id,
            markedAt: assignment.assignedAt,
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
          currentLabelChangedAt: assignment.assignedAt,
          ...(repetitionPlan
            ? {
                repetitionReminderDays: repetitionPlan.reminderDays,
                nextRepetitionReminderAt: repetitionPlan.dueAt,
              }
            : {
                ...(label === LeadLabel.REPETICIONES
                  ? {}
                  : {}),
              }),
        },
        select: this.leadSelect(),
      });

      return {
        lead: updatedLead,
        labelAssignmentId: assignment.id,
        labelHistoryId: history?.id ?? null,
        repetitionReminderId: reminderId,
        nextRepetitionReminderAt: repetitionPlan?.dueAt ?? null,
        repetitionReminderDays:
          repetitionPlan?.reminderDays ?? lead.repetitionReminderDays,
      };
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId,
      leadId,
      payload: {
        reason: 'lead_label_changed',
        action: 'added',
        label,
        labelAssignmentId: result.labelAssignmentId,
        labelHistoryId: result.labelHistoryId,
        repetitionReminderId: result.repetitionReminderId,
        nextRepetitionReminderAt:
          result.nextRepetitionReminderAt?.toISOString() ?? null,
        repetitionReminderDays: result.repetitionReminderDays,
      },
    });

    return { ...result, lead: withLeadDisplayName(result.lead) };
  }

  async removeLabel(input: RemoveLabelInput) {
    const { accountId, leadId, label, changedByUserId, reason } = input;
    const removedAt = new Date();

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        accountId: true,
        currentLabel: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.leadLabelAssignment.findFirst({
        where: {
          accountId,
          leadId,
          label,
          removedAt: null,
        },
        select: {
          id: true,
          assignedAt: true,
        },
      });

      if (!assignment) {
        return {
          ...(await this.getLeadSnapshot(tx, accountId, leadId)),
          labelAssignmentId: null,
          removed: false,
          canceledReminderCount: 0,
        };
      }

      await tx.leadLabelAssignment.update({
        where: { id: assignment.id },
        data: {
          removedAt,
          removedByUserId: changedByUserId ?? null,
          reason: reason ?? null,
        },
      });

      const canceled =
        label === LeadLabel.REPETICIONES
          ? await tx.leadRepetitionReminder.updateMany({
              where: {
                leadId,
                accountId,
                labelAssignmentId: assignment.id,
                sentAt: null,
                canceledAt: null,
              },
              data: {
                canceledAt: removedAt,
              },
            })
          : { count: 0 };

      const nextPrimary = await tx.leadLabelAssignment.findFirst({
        where: {
          leadId,
          accountId,
          removedAt: null,
        },
        orderBy: {
          assignedAt: 'desc',
        },
        select: {
          label: true,
          assignedAt: true,
        },
      });

      const updatedLead = await tx.lead.update({
        where: { id: leadId },
        data: {
          ...(lead.currentLabel === label
            ? {
                currentLabel: nextPrimary?.label ?? null,
                currentLabelChangedAt: nextPrimary?.assignedAt ?? null,
              }
            : {}),
          ...(label === LeadLabel.REPETICIONES
            ? {
                nextRepetitionReminderAt: null,
              }
            : {}),
        },
        select: this.leadSelect(),
      });

      return {
        lead: updatedLead,
        labelAssignmentId: assignment.id,
        removed: true,
        canceledReminderCount: canceled.count,
      };
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId,
      leadId,
      payload: {
        reason: 'lead_label_changed',
        action: 'removed',
        label,
        labelAssignmentId: result.labelAssignmentId,
        canceledReminderCount: result.canceledReminderCount,
      },
    });

    return {
      ...result,
      lead: withLeadDisplayName(result.lead),
    };
  }

  async getHistory(accountId: string, leadId: string) {
    await this.assertLeadExists(accountId, leadId);

    return this.prisma.leadLabelHistory.findMany({
      where: { accountId, leadId },
      orderBy: { changedAt: 'desc' },
      take: 100,
    });
  }

  async getLabels(accountId: string, leadId: string) {
    await this.assertLeadExists(accountId, leadId);

    return this.prisma.leadLabelAssignment.findMany({
      where: { accountId, leadId },
      orderBy: [{ removedAt: 'asc' }, { assignedAt: 'desc' }],
      take: 200,
    });
  }

  async listDueRepetitionReminders(accountId: string, limit: number) {
    const reminders = await this.prisma.leadRepetitionReminder.findMany({
      where: {
        accountId,
        dueAt: {
          lte: new Date(),
        },
        sentAt: null,
        canceledAt: null,
        OR: [
          {
            labelAssignment: {
              label: LeadLabel.REPETICIONES,
              removedAt: null,
            },
          },
          {
            labelAssignmentId: null,
            lead: {
              labelAssignments: {
                some: {
                  label: LeadLabel.REPETICIONES,
                  removedAt: null,
                },
              },
            },
          },
        ],
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      include: {
        lead: {
          select: this.leadSelect(),
        },
      },
    });

    return reminders.map((reminder) => ({
      ...reminder,
      lead: withLeadDisplayName(reminder.lead),
    }));
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
      lead: withLeadDisplayName(lead),
      labelHistoryId: null,
      repetitionReminderId: null,
      nextRepetitionReminderAt: lead.nextRepetitionReminderAt,
      repetitionReminderDays: lead.repetitionReminderDays,
    };
  }

  private async getLeadSnapshot(
    tx: Prisma.TransactionClient,
    accountId: string,
    leadId: string,
  ) {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, accountId },
      select: this.leadSelect(),
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    return {
      lead,
    };
  }

  private leadSearchWhere(
    accountId: string,
    search?: string | null,
  ): Prisma.LeadWhereInput {
    return {
      accountId,
      ...(search
        ? {
            OR: [
              {
                whatsappContactName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              { ycloudNickname: { contains: search, mode: 'insensitive' } },
              {
                whatsappProfileName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
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
      ycloudNickname: true,
      whatsappContactName: true,
      whatsappProfileName: true,
      phoneE164: true,
      email: true,
      status: true,
      currentLabel: true,
      currentLabelChangedAt: true,
      labelAssignments: {
        where: {
          removedAt: null,
        },
        orderBy: {
          assignedAt: 'desc',
        },
        select: {
          id: true,
          label: true,
          assignedAt: true,
          assignedByUserId: true,
        },
      },
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

  private toE164(countryCode: string, phoneNumber: string) {
    const countryDigits = countryCode.replace(/\D/g, '');
    const phoneRaw = phoneNumber.trim();

    if (phoneRaw.startsWith('+')) {
      const directDigits = phoneRaw.replace(/\D/g, '');
      if (directDigits.length < 8 || directDigits.length > 15) {
        throw new BadRequestException('Invalid phone number');
      }
      return `+${directDigits}`;
    }

    const nationalDigits = phoneRaw.replace(/\D/g, '').replace(/^00/, '');
    if (!countryDigits || countryDigits.length < 1 || countryDigits.length > 4) {
      throw new BadRequestException('Invalid country code');
    }
    if (nationalDigits.length < 5 || nationalDigits.length > 14) {
      throw new BadRequestException('Invalid phone number');
    }

    const e164 = `+${countryDigits}${nationalDigits}`;
    if (e164.length < 9 || e164.length > 16) {
      throw new BadRequestException('Invalid E.164 phone number');
    }

    return e164;
  }

  /**
   * Exporta leads en JSON paginado, filtrando por rango de fechas de creación.
   * Pensado para integraciones externas (n8n) vía LeadsExportController
   * (protegido con ApiKeyGuard, no requiere JWT).
   */
  async exportLeads(input: ExportLeadsInput) {
    const { from, to, page, pageSize, accountId, label } = input;

    const where: Prisma.LeadWhereInput = {
      ...(accountId ? { accountId } : {}),
      ...(label ? { currentLabel: label } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [total, leads] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          whatsappContactName: true,
          whatsappProfileName: true,
          phoneE164: true,
          email: true,
          status: true,
          currentLabel: true,
          accountId: true,
          account: { select: { id: true, name: true } },
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      data: leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        whatsappContactName: lead.whatsappContactName,
        whatsappProfileName: lead.whatsappProfileName,
        phoneE164: lead.phoneE164,
        email: lead.email,
        status: lead.status,
        currentLabel: lead.currentLabel,
        accountId: lead.accountId,
        comercial: lead.account?.name ?? null,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
}
