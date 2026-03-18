import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CampaignTemplateResolverService } from './campaign-template-resolver-service.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { ReengagementSkipReason } from './constant';
import { MessageDirection, MessageType, MessageStatus } from '@prisma/client';

@Injectable()
export class ReengagementDispatchService {
  private readonly logger = new Logger(ReengagementDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateResolver: CampaignTemplateResolverService,
    private readonly ycloudClient: YcloudService,
  ) {}

  async dispatch(leadCampaignId: string): Promise<void> {
    this.logger.log(`Dispatch started leadCampaignId=${leadCampaignId}`);
    const leadCampaign = await this.prisma.leadCampaign.findUnique({
      where: { id: leadCampaignId },
      include: {
        lead: true,
      },
    });

    if (!leadCampaign) {
      this.logger.warn(`LeadCampaign not found id=${leadCampaignId}`);
      return;
    }

    const lead = leadCampaign.lead;

    if (!lead.accountId) {
      this.logger.warn(`LeadAccount not found id=${lead.accountId}`);
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.LEAD_WITHOUT_ACCOUNT,
      );
      return;
    }

    const from = await this.prisma.account.findUnique({
      where: { id: lead.accountId },
      select: { phoneE164: true },
    });

    if (!from) {
      throw new Error(
        `Account phoneE164 not found for accountId=${lead.accountId}`,
      );
    }

    if (!lead.preferredLanguage) {
      this.logger.warn(`Lead preferredLanguage not found leadId=${lead.id}`);
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.LEAD_WITHOUT_LANGUAGE,
      );
      return;
    }

    if (lead.status !== 'NEW') {
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.LEAD_STATUS_CHANGED,
      );
      return;
    }

    if (lead.firstInboundAt || lead.lastInboundAt || lead.respondedAt) {
      this.logger.warn(`Lead already responded leadId=${lead.id}`);
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.LEAD_ALREADY_RESPONDED,
      );
      return;
    }

    await this.prisma.leadCampaign.update({
      where: { id: leadCampaignId },
      data: {
        status: 'PROCESSING',
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    this.logger.log(
      `Resolving template accountId=${lead.accountId} lang=${lead.preferredLanguage}`,
    );
    const resolved =
      await this.templateResolver.resolveWeek1ReengagementTemplate({
        accountId: lead.accountId,
        language: lead.preferredLanguage,
      });

    if (!resolved) {
      this.logger.warn(
        `Template not found accountId=${lead.accountId} lang=${lead.preferredLanguage}`,
      );
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.TEMPLATE_NOT_FOUND,
      );
      return;
    }

    const response = await this.ycloudClient.sendTemplateMessage({
      accountId: lead.accountId,
      from: from.phoneE164,
      to: lead.phoneE164,
      templateName: resolved.accountTemplate.name,
      languageCode: resolved.accountTemplate.language,
    });

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
        rawPayload: response as any,
        providerCreateTime:
          typeof response.createTime === 'string'
            ? new Date(response.createTime)
            : null,
        providerUpdateTime:
          typeof response.updateTime === 'string'
            ? new Date(response.updateTime)
            : null,
        currency:
          typeof response.currency === 'string' ? response.currency : null,
        totalPrice:
          typeof response.totalPrice === 'number' ? response.totalPrice : null,
      },
      select: {
        id: true,
      },
    });

    await this.prisma.leadCampaign.update({
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

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        reengagementSentAt: new Date(),
      },
    });

    this.logger.log(
      `Reengagement sent leadCampaignId=${leadCampaignId} messageId=${message.id}`,
    );
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
      },
    });
  }
}
