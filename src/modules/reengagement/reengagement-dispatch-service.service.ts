import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CampaignTemplateResolverService } from './campaign-template-resolver-service.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { ReengagementSkipReason } from './constant';
import { MessageDirection, MessageType, MessageStatus } from '@prisma/client';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';

@Injectable()
export class ReengagementDispatchService {
  private readonly logger = new Logger(ReengagementDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateResolver: CampaignTemplateResolverService,
    private readonly ycloudClient: YcloudService,
    private readonly leadLanguageResolverService: LeadLanguageResolverService,
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

    const lead = leadCampaign.lead;

    if (!lead.accountId) {
      this.logger.warn(`Lead accountId not found leadId=${lead.id}`);
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

    if (!from?.phoneE164) {
      throw new Error(
        `Account phoneE164 not found for accountId=${lead.accountId}`,
      );
    }
    const language =
      lead.preferredLanguage ??
      this.leadLanguageResolverService.resolveFromPhone(lead.phoneE164);

    if (!language) {
      this.logger.warn(`Lead language could not be resolved leadId=${lead.id}`);
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.LEAD_WITHOUT_LANGUAGE,
      );
      return;
    }

    // if (!lead.preferredLanguage) {
    //   this.logger.warn(`Lead preferredLanguage not found leadId=${lead.id}`);
    //   await this.markSkipped(
    //     leadCampaignId,
    //     ReengagementSkipReason.LEAD_WITHOUT_LANGUAGE,
    //   );
    //   return;
    // }

    if (lead.status !== 'NEW') {
      this.logger.warn(`Lead status is not NEW leadId=${lead.id}`);
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

    this.logger.log(
      `Resolving template accountId=${lead.accountId} lang=${language} leadId=${lead.id}`,
    );

    const resolved =
      await this.templateResolver.resolveWeek1ReengagementTemplate({
        accountId: lead.accountId,
        language: language,
      });

    if (!resolved) {
      this.logger.warn(
        `Template not found accountId=${lead.accountId} lang=${language} leadId=${lead.id}`,
      );
      await this.markSkipped(
        leadCampaignId,
        ReengagementSkipReason.TEMPLATE_NOT_FOUND,
      );
      return;
    }
    if (!leadCampaign.externalId) {
      throw new Error(
        `LeadCampaign externalId not found leadCampaignId=${leadCampaignId}`,
      );
    }

    // Fase 1: llamada al provider.
    // Si falla aquí, el worker puede decidir retry/fail.
    const response = await this.ycloudClient.sendTemplateMessage({
      accountId: lead.accountId,
      from: from.phoneE164,
      to: lead.phoneE164,
      templateName: resolved.accountTemplate.name,
      languageCode: resolved.accountTemplate.language,
      externalId: leadCampaign.externalId,
    });

    // Fase 2: persistencia local post-provider.
    // Si algo falla aquí, el resultado es incierto: pudo haberse enviado ya.
    try {
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
          externalId: leadCampaign.externalId,
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
            typeof response.totalPrice === 'number'
              ? response.totalPrice
              : null,
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

      // MUY IMPORTANTE:
      // no relanzamos para evitar que el worker haga retry y reenvíe a YCloud.
      return;
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
}
