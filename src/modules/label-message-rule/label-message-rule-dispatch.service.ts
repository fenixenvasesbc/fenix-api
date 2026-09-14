import { Injectable, Logger } from '@nestjs/common';
import {
  AccountGlobalTemplateStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';
import { YcloudService } from '../ycloud/ycloud.service';
import {
  LABEL_MESSAGE_RULE_BUSINESS_WINDOW_PREFIX,
  LabelMessageRuleSkipReason,
} from './constant';

@Injectable()
export class LabelMessageRuleDispatchService {
  private readonly logger = new Logger(LabelMessageRuleDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
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
      include: { lead: true },
    });

    if (!leadCampaign) {
      this.logger.warn(
        `LeadCampaign not found after claim id=${leadCampaignId}`,
      );
      return;
    }

    const parsed = this.parseBusinessWindowKey(leadCampaign.businessWindowKey);
    if (!parsed) {
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.RULE_NOT_FOUND,
      );
      return;
    }

    const rule = await this.prisma.labelMessageRule.findUnique({
      where: { id: parsed.ruleId },
    });

    if (!rule) {
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.RULE_NOT_FOUND,
      );
      return;
    }

    if (!rule.active) {
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.RULE_INACTIVE,
      );
      return;
    }

    const lead = leadCampaign.lead;

    if (!lead.accountId) {
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.LEAD_WITHOUT_ACCOUNT,
      );
      return;
    }

    const assignment = await this.prisma.leadLabelAssignment.findFirst({
      where: {
        id: parsed.assignmentId,
        leadId: lead.id,
        accountId: lead.accountId,
        label: rule.labelCode,
        removedAt: null,
      },
      select: { id: true },
    });

    if (!assignment) {
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.LEAD_LABEL_CHANGED,
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
        LabelMessageRuleSkipReason.LEAD_WITHOUT_LANGUAGE,
      );
      return;
    }

    const globalTemplate = await this.prisma.globalWhatsappTemplate.findUnique({
      where: {
        name_language: {
          name: rule.templateName,
          language,
        },
      },
    });

    if (!globalTemplate) {
      this.logger.warn(
        `Label message rule template not found ruleId=${rule.id} templateName=${rule.templateName} lang=${language} leadId=${lead.id}`,
      );
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.TEMPLATE_NOT_FOUND,
      );
      return;
    }

    const accountTemplate =
      await this.prisma.globalWhatsappTemplateAccount.findUnique({
        where: {
          globalTemplateId_accountId: {
            globalTemplateId: globalTemplate.id,
            accountId: lead.accountId,
          },
        },
      });

    if (
      !accountTemplate ||
      accountTemplate.status !== AccountGlobalTemplateStatus.APPROVED
    ) {
      this.logger.warn(
        `Label message rule template not approved for account ruleId=${rule.id} templateId=${globalTemplate.id} accountId=${lead.accountId} status=${accountTemplate?.status ?? 'MISSING'}`,
      );
      await this.markSkipped(
        leadCampaignId,
        LabelMessageRuleSkipReason.TEMPLATE_NOT_APPROVED,
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
      templateName: globalTemplate.name,
      languageCode: globalTemplate.language,
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
          templateName: globalTemplate.name,
          templateLang: globalTemplate.language,
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
        select: { id: true, createdAt: true, providerCreateTime: true },
      });

      const conversation = await this.conversationService.touchOutbound({
        accountId: lead.accountId,
        leadId: lead.id,
        messageId: message.id,
        outboundAt: message.providerCreateTime ?? message.createdAt,
      });

      await this.prisma.leadCampaign.update({
        where: { id: leadCampaignId },
        data: {
          status: 'SENT',
          targetTemplateName: globalTemplate.name,
          messageId: message.id,
          sentAt: new Date(),
          lastError: null,
        },
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
          source: 'label_message_rule',
        },
      });

      await this.chatEvents.publish({
        type: 'conversation.updated',
        accountId: lead.accountId,
        leadId: lead.id,
        conversationId: conversation.id,
        messageId: message.id,
        payload: {
          reason: 'label_message_rule_sent',
          ruleId: rule.id,
        },
      });

      this.logger.log(
        `Label message rule sent leadCampaignId=${leadCampaignId} ruleId=${rule.id} messageId=${message.id}`,
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
      data: { status: 'FAILED', lastError: reason },
    });
  }

  async markUnknown(leadCampaignId: string, reason: string): Promise<void> {
    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: { status: 'UNKNOWN', lastError: reason },
    });
  }

  private async markSkipped(
    leadCampaignId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: { status: 'SKIPPED', skipReason: reason, lastError: null },
    });
  }

  private parseBusinessWindowKey(businessWindowKey: string) {
    const prefix = `${LABEL_MESSAGE_RULE_BUSINESS_WINDOW_PREFIX}:`;
    if (!businessWindowKey.startsWith(prefix)) return null;

    const rest = businessWindowKey.slice(prefix.length);
    const [ruleId, assignmentId] = rest.split(':');
    if (!ruleId || !assignmentId) return null;

    return { ruleId, assignmentId };
  }
}
