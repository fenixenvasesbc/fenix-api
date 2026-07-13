import { Injectable, Logger } from '@nestjs/common';
import {
  LeadLabel,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';
import { CampaignTemplateResolverService } from '../reengagement/campaign-template-resolver-service.service';
import { YcloudService } from '../ycloud/ycloud.service';
import {
  REPETITION_REMINDER_BUSINESS_WINDOW_PREFIX,
  RepetitionReminderSkipReason,
} from './constant';

@Injectable()
export class RepetitionReminderDispatchService {
  private readonly logger = new Logger(RepetitionReminderDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateResolver: CampaignTemplateResolverService,
    private readonly ycloudClient: YcloudService,
    private readonly leadLanguageResolverService: LeadLanguageResolverService,
    private readonly conversationService: ConversationService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async dispatch(leadCampaignId: string): Promise<void> {
    this.logger.log(`Dispatch started leadCampaignId=${leadCampaignId}`);

    const claimed = await this.prisma.leadCampaign.updateMany({
      where: {
        id: leadCampaignId,
        status: 'ENQUEUED',
        messageId: null,
      },
      data: {
        status: 'PROCESSING',
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      this.logger.warn(
        `LeadCampaign already claimed or processed id=${leadCampaignId}`,
      );
      return;
    }

    const leadCampaign = await this.prisma.leadCampaign.findUnique({
      where: { id: leadCampaignId },
      include: {
        lead: true,
      },
    });

    if (!leadCampaign) {
      this.logger.warn(
        `LeadCampaign not found after claim id=${leadCampaignId}`,
      );
      return;
    }

    const reminderId = this.extractReminderId(leadCampaign.businessWindowKey);
    if (!reminderId) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.REMINDER_NOT_FOUND,
      );
      return;
    }

    const reminder = await this.prisma.leadRepetitionReminder.findUnique({
      where: { id: reminderId },
      select: {
        id: true,
        accountId: true,
        leadId: true,
        dueAt: true,
        sentAt: true,
        canceledAt: true,
      },
    });

    if (!reminder || reminder.leadId !== leadCampaign.leadId) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.REMINDER_NOT_FOUND,
      );
      return;
    }

    if (reminder.sentAt) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.REMINDER_ALREADY_SENT,
      );
      return;
    }

    if (reminder.canceledAt) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.REMINDER_CANCELED,
      );
      return;
    }

    const lead = leadCampaign.lead;

    if (!lead.accountId) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.LEAD_WITHOUT_ACCOUNT,
      );
      return;
    }

    if (lead.currentLabel !== LeadLabel.REPETICIONES) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.LEAD_LABEL_CHANGED,
      );
      return;
    }

    const from = await this.prisma.account.findUnique({
      where: { id: lead.accountId },
      select: { phoneE164: true },
    });

    if (!from?.phoneE164) {
      throw new Error(
        `Account phoneE164 not found for accountId=${lead.accountId}`,
      );
    }

    const language =
      lead.preferredLanguage ??
      this.leadLanguageResolverService.resolveFromPhone(lead.phoneE164);

    if (!language) {
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.LEAD_WITHOUT_LANGUAGE,
      );
      return;
    }

    const resolved =
      await this.templateResolver.resolveRepetitionReminderTemplate({
        accountId: lead.accountId,
        language,
      });

    if (!resolved) {
      this.logger.warn(
        `Repetition template not found accountId=${lead.accountId} lang=${language} leadId=${lead.id}`,
      );
      await this.markSkipped(
        leadCampaignId,
        RepetitionReminderSkipReason.TEMPLATE_NOT_FOUND,
      );
      return;
    }

    if (!leadCampaign.externalId) {
      throw new Error(
        `LeadCampaign externalId not found leadCampaignId=${leadCampaignId}`,
      );
    }

    const response = await this.ycloudClient.sendTemplateMessage({
      accountId: lead.accountId,
      from: from.phoneE164,
      to: lead.phoneE164,
      templateName: resolved.accountTemplate.name,
      languageCode: resolved.accountTemplate.language,
      externalId: leadCampaign.externalId,
    });

    try {
      const now = new Date();
      const providerCreateTime =
        typeof response.createTime === 'string'
          ? new Date(response.createTime)
          : now;

      const message = await this.prisma.message.create({
        data: {
          accountId: lead.accountId,
          leadId: lead.id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEMPLATE,
          templateName: resolved.accountTemplate.name,
          templateLang: resolved.accountTemplate.language,
          status: MessageStatus.ACCEPTED,
          ycloudMessageId: typeof response.id === 'string' ? response.id : null,
          wamid: typeof response.wamid === 'string' ? response.wamid : null,
          pricingCategory:
            typeof response.pricingCategory === 'string'
              ? response.pricingCategory
              : null,
          rawPayload: response as Prisma.InputJsonValue,
          externalId: leadCampaign.externalId,
          providerCreateTime,
          providerUpdateTime:
            typeof response.updateTime === 'string'
              ? new Date(response.updateTime)
              : null,
          currency:
            typeof response.currency === 'string' ? response.currency : null,
          totalPrice:
            typeof response.totalPrice === 'number'
              ? response.totalPrice
              : null,
        },
        select: {
          id: true,
          createdAt: true,
          providerCreateTime: true,
        },
      });

      const conversation = await this.conversationService.touchOutbound({
        accountId: lead.accountId,
        leadId: lead.id,
        messageId: message.id,
        outboundAt: message.providerCreateTime ?? message.createdAt,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.leadCampaign.update({
          where: { id: leadCampaignId },
          data: {
            status: 'SENT',
            targetTemplateName: resolved.accountTemplate.name,
            accountCampaignTemplateId: resolved.accountTemplate.id,
            messageId: message.id,
            sentAt: new Date(),
            lastError: null,
          },
        });

        await tx.leadRepetitionReminder.update({
          where: { id: reminder.id },
          data: {
            sentAt: new Date(),
            lastError: null,
          },
        });

        await tx.lead.updateMany({
          where: {
            id: lead.id,
            nextRepetitionReminderAt: reminder.dueAt,
          },
          data: {
            nextRepetitionReminderAt: null,
          },
        });
      });

      await this.chatEvents.publish({
        type: 'message.created',
        accountId: lead.accountId,
        leadId: lead.id,
        conversationId: conversation.id,
        messageId: message.id,
        payload: {
          direction: MessageDirection.OUTBOUND,
          messageType: MessageType.TEMPLATE,
          status: MessageStatus.ACCEPTED,
          source: 'repetition_reminder',
        },
      });

      await this.chatEvents.publish({
        type: 'conversation.updated',
        accountId: lead.accountId,
        leadId: lead.id,
        conversationId: conversation.id,
        messageId: message.id,
        payload: {
          reason: 'repetition_reminder_sent',
          reminderId: reminder.id,
        },
      });

      this.logger.log(
        `Repetition reminder sent leadCampaignId=${leadCampaignId} reminderId=${reminder.id} messageId=${message.id}`,
      );
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Unknown post-provider persistence error';

      this.logger.error(
        `Post-provider persistence failed leadCampaignId=${leadCampaignId} reason=${reason}`,
      );

      try {
        await this.markUnknown(
          leadCampaignId,
          `POST_PROVIDER_PERSISTENCE_FAILURE: ${reason}`,
        );
      } catch (markUnknownError) {
        const unknownReason =
          markUnknownError instanceof Error
            ? markUnknownError.message
            : 'Unknown markUnknown error';

        this.logger.error(
          `Failed to mark UNKNOWN leadCampaignId=${leadCampaignId} reason=${unknownReason}`,
        );
      }
    }
  }

  async markFailed(leadCampaignId: string, reason: string): Promise<void> {
    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: {
        status: 'FAILED',
        lastError: reason,
      },
    });
  }

  async markUnknown(leadCampaignId: string, reason: string): Promise<void> {
    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: {
        status: 'UNKNOWN',
        lastError: reason,
      },
    });
  }

  private async markSkipped(
    leadCampaignId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: {
        status: 'SKIPPED',
        skipReason: reason,
        lastError: null,
      },
    });
  }

  private extractReminderId(businessWindowKey: string) {
    const prefix = `${REPETITION_REMINDER_BUSINESS_WINDOW_PREFIX}:`;
    if (!businessWindowKey.startsWith(prefix)) return null;
    return businessWindowKey.slice(prefix.length) || null;
  }
}
