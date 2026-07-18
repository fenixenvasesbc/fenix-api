import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AppNotificationStatus,
  AppNotificationType,
  LeadLabel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { withLeadDisplayName } from 'src/common/utils/lead-name';
import { ChatEventsService } from '../chat-events/chat-events.service';

type LabelAlertRule = {
  label: LeadLabel;
  days: number;
};

const DEFAULT_LABEL_ALERT_DAYS: Partial<Record<LeadLabel, number>> = {
  [LeadLabel.MUESTRAS]: 7,
  [LeadLabel.BOCETO_EN_PROCESO]: 4,
  [LeadLabel.PENDIENTE_DE_PAGO]: 7,
  [LeadLabel.PRODUCCION]: 14,
  [LeadLabel.BOCETOS_ATRASADOS]: 2,
};

const LABEL_DISPLAY_NAMES: Record<LeadLabel, string> = {
  [LeadLabel.PRODUCCION]: 'Produccion',
  [LeadLabel.BOCETO_EN_PROCESO]: 'Boceto en proceso',
  [LeadLabel.PENDIENTE_DE_PAGO]: 'Pendiente de pago',
  [LeadLabel.MUESTRAS]: 'Muestras',
  [LeadLabel.REPETICIONES]: 'Repeticiones',
  [LeadLabel.BOCETOS_ATRASADOS]: 'Boceto atrasado',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async listByAccount(input: {
    accountId: string;
    status?: AppNotificationStatus | 'ALL';
    limit?: number;
  }) {
    const limit = this.clampLimit(input.limit);
    const where = {
      accountId: input.accountId,
      ...(input.status && input.status !== 'ALL'
        ? { status: input.status }
        : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
      this.prisma.appNotification.findMany({
        where,
        orderBy: [{ status: 'asc' }, { triggeredAt: 'desc' }],
        take: limit,
        include: {
          lead: true,
        },
      }),
      this.prisma.appNotification.count({
        where: {
          accountId: input.accountId,
          status: AppNotificationStatus.UNREAD,
        },
      }),
    ]);

    return {
      data: notifications.map((notification) => ({
        ...notification,
        lead: notification.lead
          ? withLeadDisplayName(notification.lead)
          : null,
      })),
      unreadCount,
    };
  }

  async markAsRead(accountId: string, notificationId: string) {
    const notification = await this.prisma.appNotification.findFirst({
      where: {
        id: notificationId,
        accountId,
      },
      include: {
        lead: true,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.status === AppNotificationStatus.READ) {
      return {
        ...notification,
        lead: notification.lead
          ? withLeadDisplayName(notification.lead)
          : null,
      };
    }

    const updated = await this.prisma.appNotification.update({
      where: { id: notification.id },
      data: {
        status: AppNotificationStatus.READ,
        readAt: new Date(),
      },
      include: {
        lead: true,
      },
    });

    await this.chatEvents.publish({
      type: 'notification.updated',
      accountId,
      leadId: updated.leadId,
      payload: {
        notificationId: updated.id,
        status: updated.status,
        unreadCount: await this.countUnread(accountId),
      },
    });

    return {
      ...updated,
      lead: updated.lead ? withLeadDisplayName(updated.lead) : null,
    };
  }

  async markAllAsRead(accountId: string) {
    const now = new Date();

    await this.prisma.appNotification.updateMany({
      where: {
        accountId,
        status: AppNotificationStatus.UNREAD,
      },
      data: {
        status: AppNotificationStatus.READ,
        readAt: now,
      },
    });

    await this.chatEvents.publish({
      type: 'notification.updated',
      accountId,
      payload: {
        status: AppNotificationStatus.READ,
        unreadCount: 0,
        scope: 'all',
      },
    });

    return { unreadCount: 0 };
  }

  async markLabelStaleAsRead(accountId: string, label: LeadLabel) {
    const now = new Date();

    const result = await this.prisma.appNotification.updateMany({
      where: {
        accountId,
        type: AppNotificationType.LABEL_STALE,
        label,
        status: AppNotificationStatus.UNREAD,
      },
      data: {
        status: AppNotificationStatus.READ,
        readAt: now,
      },
    });

    const unreadCount = await this.countUnread(accountId);

    await this.chatEvents.publish({
      type: 'notification.updated',
      accountId,
      payload: {
        type: AppNotificationType.LABEL_STALE,
        label,
        status: AppNotificationStatus.READ,
        unreadCount,
        scope: 'label-stale-group',
        updatedCount: result.count,
      },
    });

    return {
      unreadCount,
      updatedCount: result.count,
    };
  }

  async runLabelAlerts(now = new Date()) {
    const rules = this.resolveLabelAlertRules();
    const limit = this.resolveBatchLimit();
    let createdCount = 0;
    let inspectedCount = 0;

    for (const rule of rules) {
      const cutoff = new Date(now.getTime() - rule.days * 24 * 60 * 60 * 1000);
      const staleLeads = await this.prisma.lead.findMany({
        where: {
          accountId: { not: null },
          currentLabel: rule.label,
          currentLabelChangedAt: {
            lte: cutoff,
          },
        },
        orderBy: {
          currentLabelChangedAt: 'asc',
        },
        take: limit,
        select: {
          id: true,
          accountId: true,
          phoneE164: true,
          name: true,
          ycloudNickname: true,
          whatsappContactName: true,
          whatsappProfileName: true,
          whatsappUsername: true,
          currentLabel: true,
          currentLabelChangedAt: true,
        },
      });

      inspectedCount += staleLeads.length;

      for (const lead of staleLeads) {
        if (!lead.accountId || !lead.currentLabelChangedAt) continue;

        const dedupeKey = this.labelStaleDedupeKey({
          leadId: lead.id,
          label: rule.label,
          changedAt: lead.currentLabelChangedAt,
        });
        const leadName = this.leadDisplayName(lead);
        const labelName = LABEL_DISPLAY_NAMES[rule.label];
        const daysInLabel = Math.floor(
          (now.getTime() - lead.currentLabelChangedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        );

        const created = await this.createLabelStaleNotificationIfNeeded({
          accountId: lead.accountId,
          leadId: lead.id,
          dedupeKey,
          label: rule.label,
          title: `${leadName} lleva ${daysInLabel} dias en ${labelName}`,
          message: `El lead ${leadName} permanece en ${labelName} desde ${lead.currentLabelChangedAt.toISOString()}. Umbral configurado: ${rule.days} dias.`,
          triggeredAt: now,
          metadata: {
            leadPhoneE164: lead.phoneE164,
            labelChangedAt: lead.currentLabelChangedAt.toISOString(),
            thresholdDays: rule.days,
            daysInLabel,
          },
        });

        if (created) createdCount += 1;
      }
    }

    this.logger.log(
      `Label alert notification run finished rules=${rules.length} inspected=${inspectedCount} created=${createdCount}`,
    );

    return {
      rules: rules.length,
      inspected: inspectedCount,
      created: createdCount,
    };
  }

  private async createLabelStaleNotificationIfNeeded(input: {
    accountId: string;
    leadId: string;
    dedupeKey: string;
    label: LeadLabel;
    title: string;
    message: string;
    triggeredAt: Date;
    metadata: Record<string, unknown>;
  }) {
    const existing = await this.prisma.appNotification.findUnique({
      where: {
        accountId_dedupeKey: {
          accountId: input.accountId,
          dedupeKey: input.dedupeKey,
        },
      },
      select: {
        id: true,
      },
    });

    if (existing) return false;

    const notification = await this.prisma.appNotification.create({
      data: {
        accountId: input.accountId,
        leadId: input.leadId,
        type: AppNotificationType.LABEL_STALE,
        dedupeKey: input.dedupeKey,
        label: input.label,
        title: input.title,
        message: input.message,
        triggeredAt: input.triggeredAt,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });

    await this.chatEvents.publish({
      type: 'notification.created',
      accountId: input.accountId,
      leadId: input.leadId,
      payload: {
        notification,
        unreadCount: await this.countUnread(input.accountId),
      },
    });

    return true;
  }

  private resolveLabelAlertRules(): LabelAlertRule[] {
    return Object.values(LeadLabel)
      .map((label) => {
        const days = this.resolveDaysForLabel(label);
        return days ? { label, days } : null;
      })
      .filter(Boolean) as LabelAlertRule[];
  }

  private resolveDaysForLabel(label: LeadLabel) {
    const envName = `NOTIFICATION_LABEL_ALERT_${label}_DAYS`;
    const raw = process.env[envName];

    if (raw !== undefined && raw.trim() !== '') {
      const value = Number(raw);
      if (Number.isInteger(value) && value > 0) return value;
      return null;
    }

    return DEFAULT_LABEL_ALERT_DAYS[label] ?? null;
  }

  private labelStaleDedupeKey(input: {
    leadId: string;
    label: LeadLabel;
    changedAt: Date;
  }) {
    return `label-stale:${input.leadId}:${input.label}:${input.changedAt.toISOString()}`;
  }

  private leadDisplayName(lead: {
    name: string | null;
    ycloudNickname: string | null;
    whatsappContactName: string | null;
    whatsappProfileName: string | null;
    whatsappUsername: string | null;
    phoneE164: string;
  }) {
    return (
      lead.ycloudNickname ||
      lead.whatsappContactName ||
      lead.whatsappProfileName ||
      lead.name ||
      lead.whatsappUsername ||
      lead.phoneE164
    );
  }

  private async countUnread(accountId: string) {
    return this.prisma.appNotification.count({
      where: {
        accountId,
        status: AppNotificationStatus.UNREAD,
      },
    });
  }

  private clampLimit(limit?: number) {
    if (!limit || !Number.isInteger(limit) || limit < 1) return 50;
    return Math.min(limit, 200);
  }

  private resolveBatchLimit() {
    const raw = Number(process.env.NOTIFICATION_LABEL_ALERT_BATCH_LIMIT ?? 500);
    if (!Number.isInteger(raw) || raw < 1) return 500;
    return Math.min(raw, 5000);
  }
}
