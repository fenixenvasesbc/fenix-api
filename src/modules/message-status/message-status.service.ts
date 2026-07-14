import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudMessageUpdatedEventDto,
  YCloudUpdatedWhatsappMessageDto,
  WhatsappMessageStatus,
} from '../../common/types/ycloud-message-updated.dto';
import {
  LeadStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';
import { normalizeLeadName } from 'src/common/utils/lead-name';

@Injectable()
export class MessageStatusService {
  private readonly logger = new Logger(MessageStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatEvents: ChatEventsService,
    private readonly conversationService: ConversationService,
  ) {}

  async process(job: WebhookInboxJob): Promise<void> {
    const event: YCloudMessageUpdatedEventDto = this.parseEvent(job.payload);
    const whatsappMessage: YCloudUpdatedWhatsappMessageDto =
      event.whatsappMessage;

    const nextStatus = this.normalizeStatus(whatsappMessage.status);

    if (!nextStatus) {
      this.logger.warn(
        `Unsupported status providerEventId=${job.providerEventId} status=${String(
          whatsappMessage.status,
        )}`,
      );
      return;
    }

    const providerUpdateTime = this.resolveProviderUpdateTime(
      event,
      whatsappMessage,
      nextStatus,
    );

    const errorPayload = this.buildErrorPayload(whatsappMessage);

    const message = await this.findMessage(whatsappMessage);

    if (!message) {
      this.logger.warn(
        `Message not found for updated event; attempting manual outbound reconstruction providerEventId=${job.providerEventId} ycloudMessageId=${whatsappMessage.id ?? '-'} wamid=${whatsappMessage.wamid ?? '-'} externalId=${whatsappMessage.externalId ?? '-'} type=${whatsappMessage.type ?? '-'} status=${whatsappMessage.status ?? '-'} from=${whatsappMessage.from ?? '-'} to=${whatsappMessage.to ?? '-'} wabaId=${whatsappMessage.wabaId ?? '-'}`,
      );

      const manualMessage = await this.createManualOutboundIfPossible({
        job,
        whatsappMessage,
        nextStatus,
        providerUpdateTime,
        errorPayload,
      });

      if (manualMessage) {
        await this.publishManualOutboundCreated(manualMessage, nextStatus);
        return;
      }

      await this.reconcileUnknownWithoutMessage({
        job,
        whatsappMessage,
        nextStatus,
        providerUpdateTime,
        errorPayload,
      });
      return;
    }

    if (!this.shouldUpdate(message.status, nextStatus)) {
      this.logger.log(
        `Ignoring non-forward transition messageId=${message.id} current=${message.status} next=${nextStatus}`,
      );

      await this.prisma.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      });

      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: nextStatus,
          providerUpdateTime,
          recipientWhatsAppUserId: whatsappMessage.recipientUserId ?? undefined,

          recipientParentUserId:
            whatsappMessage.parentRecipientUserId ?? undefined,

          customerUsername:
            whatsappMessage.customerProfile?.username ?? undefined,

          customerDisplayName:
            whatsappMessage.customerProfile?.name ?? undefined,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
          ycloudMessageId: whatsappMessage.id ?? message.ycloudMessageId,
          wamid: whatsappMessage.wamid ?? message.wamid,
          externalId: whatsappMessage.externalId ?? message.externalId,
        },
      });

      await tx.messageStatusHistory.create({
        data: {
          messageId: message.id,
          fromStatus: message.status,
          toStatus: nextStatus,
          providerEventId: job.providerEventId,
          providerTime: providerUpdateTime,
          payload: job.payload as Prisma.InputJsonValue,
        },
      });

      const leadCampaign = await tx.leadCampaign.findFirst({
        where: { messageId: message.id },
        select: {
          id: true,
          status: true,
        },
      });

      if (leadCampaign?.status === 'UNKNOWN') {
        await tx.leadCampaign.update({
          where: { id: leadCampaign.id },
          data:
            nextStatus === 'FAILED'
              ? {
                  status: 'FAILED',
                  lastError: this.resolveFailureReason(whatsappMessage),
                }
              : {
                  status: 'SENT',
                  sentAt: providerUpdateTime,
                  lastError: null,
                },
        });
      }

      await tx.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      });
    });

    await this.chatEvents.publish({
      type: 'message.status.updated',
      accountId: message.accountId,
      leadId: message.leadId,
      messageId: message.id,
      payload: {
        status: nextStatus,
        providerUpdateTime: providerUpdateTime.toISOString(),
      },
    });
  }

  private parseEvent(payload: unknown): YCloudMessageUpdatedEventDto {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid updated payload');
    }

    const event = payload as YCloudMessageUpdatedEventDto;

    if (event.type !== 'whatsapp.message.updated') {
      throw new Error(`Unexpected event type: ${String(event.type)}`);
    }

    if (!event.id) {
      throw new Error('Missing event id');
    }

    if (!event.createTime) {
      throw new Error('Missing event createTime');
    }

    if (!event.whatsappMessage) {
      throw new Error('Missing whatsappMessage');
    }

    if (!event.whatsappMessage.id) {
      throw new Error('Missing whatsappMessage.id');
    }

    if (!event.whatsappMessage.status) {
      throw new Error('Missing whatsappMessage.status');
    }

    return event;
  }

  private async findMessage(whatsappMessage: YCloudUpdatedWhatsappMessageDto) {
    if (whatsappMessage.id) {
      const byYCloudId = await this.prisma.message.findFirst({
        where: { ycloudMessageId: whatsappMessage.id },
      });

      if (byYCloudId) return byYCloudId;
    }

    if (whatsappMessage.wamid) {
      const byWamid = await this.prisma.message.findFirst({
        where: { wamid: whatsappMessage.wamid },
      });

      if (byWamid) return byWamid;
    }

    if (whatsappMessage.externalId) {
      const byExternalId = await this.prisma.message.findFirst({
        where: { externalId: whatsappMessage.externalId },
      });

      if (byExternalId) return byExternalId;
    }

    return null;
  }

  private async createManualOutboundIfPossible(params: {
    job: WebhookInboxJob;
    whatsappMessage: YCloudUpdatedWhatsappMessageDto;
    nextStatus: WhatsappMessageStatus;
    providerUpdateTime: Date;
    errorPayload?: Prisma.InputJsonValue;
  }): Promise<{
    accountId: string;
    leadId: string;
    messageId: string;
    conversationId: string;
    messageType: MessageType;
  } | null> {
    const {
      job,
      whatsappMessage,
      nextStatus,
      providerUpdateTime,
      errorPayload,
    } = params;

    const wabaId = this.nonEmpty(whatsappMessage.wabaId);
    const from = this.nonEmpty(whatsappMessage.from);
    const to = this.nonEmpty(whatsappMessage.to);
    const ycloudMessageId = this.nonEmpty(whatsappMessage.id);

    if (!wabaId || !from || !to || !ycloudMessageId) {
      this.logManualOutboundSkipped(job.providerEventId, 'missing_identifiers', {
        hasWabaId: Boolean(wabaId),
        hasFrom: Boolean(from),
        hasTo: Boolean(to),
        hasYcloudMessageId: Boolean(ycloudMessageId),
        rawWabaId: whatsappMessage.wabaId ?? null,
        rawFrom: whatsappMessage.from ?? null,
        rawTo: whatsappMessage.to ?? null,
        rawYcloudMessageId: whatsappMessage.id ?? null,
      });
      return null;
    }

    const messageType = this.mapManualOutboundType(whatsappMessage.type);
    if (!messageType) {
      this.logManualOutboundSkipped(job.providerEventId, 'unsupported_type', {
        ycloudMessageId,
        rawType: whatsappMessage.type ?? null,
        from,
        to,
        wabaId,
      });
      return null;
    }

    const content = this.extractManualOutboundContent(
      whatsappMessage,
      messageType,
    );
    if (!content) {
      this.logManualOutboundSkipped(job.providerEventId, 'missing_content', {
        ycloudMessageId,
        messageType,
        rawType: whatsappMessage.type ?? null,
        hasTextBody: Boolean(this.nonEmpty(whatsappMessage.text?.body)),
        hasImageLink: Boolean(this.nonEmpty(whatsappMessage.image?.link)),
        hasAudioLink: Boolean(this.nonEmpty(whatsappMessage.audio?.link)),
        hasVideoLink: Boolean(this.nonEmpty(whatsappMessage.video?.link)),
        hasDocumentLink: Boolean(
          this.nonEmpty(whatsappMessage.document?.link),
        ),
      });
      return null;
    }

    const account = await this.prisma.account.findUnique({
      where: {
        wabaId_phoneE164: {
          wabaId,
          phoneE164: from,
        },
      },
      select: {
        id: true,
      },
    });

    if (!account) {
      this.logManualOutboundSkipped(job.providerEventId, 'account_not_found', {
        ycloudMessageId,
        wabaId,
        from,
        to,
      });
      return null;
    }

    const externalId = this.nonEmpty(whatsappMessage.externalId);
    const wamid = this.nonEmpty(whatsappMessage.wamid);
    const providerCreateTime = whatsappMessage.createTime
      ? new Date(whatsappMessage.createTime)
      : null;
    const providerSendTime = whatsappMessage.sendTime
      ? new Date(whatsappMessage.sendTime)
      : providerCreateTime;
    const outboundAt =
      providerSendTime ?? providerCreateTime ?? providerUpdateTime;
    const whatsappProfileName = normalizeLeadName(
      whatsappMessage.customerProfile?.name,
    );

    const manualOutbound = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.upsert({
        where: {
          accountId_phoneE164: {
            accountId: account.id,
            phoneE164: to,
          },
        },
        create: {
          accountId: account.id,
          phoneE164: to,
          name: whatsappProfileName ?? undefined,
          whatsappProfileName: whatsappProfileName ?? undefined,
          whatsappUserId: whatsappMessage.recipientUserId ?? undefined,
          whatsappParentUserId:
            whatsappMessage.parentRecipientUserId ?? undefined,
          whatsappUsername:
            whatsappMessage.customerProfile?.username ?? undefined,
          status: LeadStatus.NEW,
          firstOutboundAt: outboundAt,
          lastOutboundAt: outboundAt,
          lastMessageAt: outboundAt,
        },
        update: {
          whatsappProfileName: whatsappProfileName ?? undefined,
          whatsappUserId: whatsappMessage.recipientUserId ?? undefined,
          whatsappParentUserId:
            whatsappMessage.parentRecipientUserId ?? undefined,
          whatsappUsername:
            whatsappMessage.customerProfile?.username ?? undefined,
          lastOutboundAt: outboundAt,
          lastMessageAt: outboundAt,
        },
        select: {
          id: true,
          firstOutboundAt: true,
        },
      });

      if (!lead.firstOutboundAt) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { firstOutboundAt: outboundAt },
        });
      }

      const message = await tx.message.upsert({
        where: {
          accountId_ycloudMessageId: {
            accountId: account.id,
            ycloudMessageId,
          },
        },
        update: {
          status: nextStatus as MessageStatus,
          providerUpdateTime,
          providerCreateTime: providerCreateTime ?? undefined,
          providerSendTime: providerSendTime ?? undefined,
          wamid: wamid ?? undefined,
          externalId: externalId ?? undefined,
          recipientWhatsAppUserId: whatsappMessage.recipientUserId ?? undefined,
          recipientParentUserId:
            whatsappMessage.parentRecipientUserId ?? undefined,
          customerUsername:
            whatsappMessage.customerProfile?.username ?? undefined,
          customerDisplayName:
            whatsappMessage.customerProfile?.name ?? undefined,
          pricingCategory: whatsappMessage.pricingCategory ?? undefined,
          totalPrice:
            typeof whatsappMessage.totalPrice === 'number'
              ? whatsappMessage.totalPrice
              : undefined,
          currency: whatsappMessage.currency ?? undefined,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
          ...content,
        },
        create: {
          accountId: account.id,
          leadId: lead.id,
          direction: MessageDirection.OUTBOUND,
          type: messageType,
          status: nextStatus as MessageStatus,
          ycloudMessageId,
          wamid,
          externalId,
          recipientWhatsAppUserId: whatsappMessage.recipientUserId ?? null,
          recipientParentUserId: whatsappMessage.parentRecipientUserId ?? null,
          customerUsername: whatsappMessage.customerProfile?.username ?? null,
          customerDisplayName: whatsappMessage.customerProfile?.name ?? null,
          pricingCategory: whatsappMessage.pricingCategory ?? null,
          totalPrice:
            typeof whatsappMessage.totalPrice === 'number'
              ? whatsappMessage.totalPrice
              : null,
          currency: whatsappMessage.currency ?? null,
          providerCreateTime,
          providerSendTime,
          providerUpdateTime,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
          ...content,
        },
        select: {
          id: true,
        },
      });

      await tx.messageStatusHistory.create({
        data: {
          messageId: message.id,
          fromStatus: null,
          toStatus: nextStatus,
          providerEventId: job.providerEventId,
          providerTime: providerUpdateTime,
          payload: job.payload as Prisma.InputJsonValue,
        },
      });

      const conversation = await this.conversationService.touchOutboundTx(tx, {
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        outboundAt,
      });

      await tx.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          accountId: account.id,
          leadId: lead.id,
          messageId: message.id,
          processedAt: new Date(),
          lastError: null,
        },
      });

      return {
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        conversationId: conversation.id,
        messageType,
      };
    });

    this.logger.log(
      `Manual outbound reconstructed providerEventId=${job.providerEventId} ycloudMessageId=${ycloudMessageId} accountId=${manualOutbound.accountId} leadId=${manualOutbound.leadId} messageId=${manualOutbound.messageId} conversationId=${manualOutbound.conversationId} type=${messageType} status=${nextStatus}`,
    );

    return manualOutbound;
  }

  private async publishManualOutboundCreated(
    message: {
      accountId: string;
      leadId: string;
      messageId: string;
      conversationId: string;
      messageType: MessageType;
    },
    status: WhatsappMessageStatus,
  ) {
    await this.chatEvents.publish({
      type: 'message.created',
      accountId: message.accountId,
      leadId: message.leadId,
      conversationId: message.conversationId,
      messageId: message.messageId,
      payload: {
        direction: MessageDirection.OUTBOUND,
        messageType: message.messageType,
        status,
        source: 'manual_whatsapp',
      },
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId: message.accountId,
      leadId: message.leadId,
      conversationId: message.conversationId,
      messageId: message.messageId,
      payload: {
        reason: 'manual_outbound_message',
      },
    });
  }

  private async reconcileUnknownWithoutMessage(params: {
    job: WebhookInboxJob;
    whatsappMessage: YCloudUpdatedWhatsappMessageDto;
    nextStatus: WhatsappMessageStatus;
    providerUpdateTime: Date;
    errorPayload?: Prisma.InputJsonValue;
  }): Promise<void> {
    const {
      job,
      whatsappMessage,
      nextStatus,
      providerUpdateTime,
      errorPayload,
    } = params;

    if (!whatsappMessage.externalId) {
      this.logger.warn(
        `Message not found and externalId missing providerEventId=${job.providerEventId} ycloudMessageId=${whatsappMessage.id} wamid=${whatsappMessage.wamid ?? '-'}`,
      );
      return;
    }

    const leadCampaign = await this.prisma.leadCampaign.findFirst({
      where: {
        externalId: whatsappMessage.externalId,
      },
      include: {
        lead: true,
      },
    });

    if (!leadCampaign) {
      this.logger.warn(
        `LeadCampaign not found by externalId providerEventId=${job.providerEventId} externalId=${whatsappMessage.externalId}`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.upsert({
        where: {
          externalId: whatsappMessage.externalId!,
        },
        update: {
          status: nextStatus,
          providerUpdateTime,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
          ycloudMessageId: whatsappMessage.id ?? undefined,
          wamid: whatsappMessage.wamid ?? undefined,
        },
        create: {
          accountId: leadCampaign.accountId,
          leadId: leadCampaign.leadId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEMPLATE,
          recipientWhatsAppUserId: whatsappMessage.recipientUserId ?? null,
          recipientParentUserId: whatsappMessage.parentRecipientUserId ?? null,
          customerUsername: whatsappMessage.customerProfile?.username ?? null,
          customerDisplayName: whatsappMessage.customerProfile?.name ?? null,
          templateName:
            leadCampaign.targetTemplateName ?? leadCampaign.sourceTemplateName,
          templateLang: leadCampaign.lead.preferredLanguage ?? null,
          status: nextStatus,
          ycloudMessageId: whatsappMessage.id ?? null,
          wamid: whatsappMessage.wamid ?? null,
          externalId: whatsappMessage.externalId!,
          providerCreateTime: whatsappMessage.createTime
            ? new Date(whatsappMessage.createTime)
            : null,
          providerUpdateTime,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      await tx.messageStatusHistory.create({
        data: {
          messageId: createdMessage.id,
          fromStatus: null,
          toStatus: nextStatus,
          providerEventId: job.providerEventId,
          providerTime: providerUpdateTime,
          payload: job.payload as Prisma.InputJsonValue,
        },
      });

      await tx.leadCampaign.update({
        where: { id: leadCampaign.id },
        data:
          nextStatus === 'FAILED'
            ? {
                status: 'FAILED',
                messageId: createdMessage.id,
                lastError: this.resolveFailureReason(whatsappMessage),
              }
            : {
                status: 'SENT',
                messageId: createdMessage.id,
                sentAt: providerUpdateTime,
                lastError: null,
              },
      });

      await tx.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      });
    });

    this.logger.log(
      `Reconciled UNKNOWN leadCampaignId=${leadCampaign.id} externalId=${whatsappMessage.externalId} nextStatus=${nextStatus}`,
    );
  }

  private mapManualOutboundType(type?: string): MessageType | null {
    const normalized = this.nonEmpty(type)?.toLowerCase();

    switch (normalized) {
      case 'text':
        return MessageType.TEXT;
      case 'image':
        return MessageType.IMAGE;
      case 'audio':
        return MessageType.AUDIO;
      case 'video':
        return MessageType.VIDEO;
      case 'document':
        return MessageType.DOCUMENT;
      default:
        return null;
    }
  }

  private logManualOutboundSkipped(
    providerEventId: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    this.logger.warn(
      `Manual outbound reconstruction skipped providerEventId=${providerEventId} reason=${reason} details=${JSON.stringify(
        details,
      )}`,
    );
  }

  private extractManualOutboundContent(
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
    messageType: MessageType,
  ): Pick<
    Prisma.MessageUncheckedCreateInput,
    'textBody' | 'mediaUrl' | 'caption' | 'mimeType' | 'fileName'
  > | null {
    if (messageType === MessageType.TEXT) {
      const textBody = this.nonEmpty(whatsappMessage.text?.body);
      return textBody ? { textBody } : null;
    }

    if (messageType === MessageType.IMAGE) {
      const mediaUrl = this.nonEmpty(whatsappMessage.image?.link);
      if (!mediaUrl) return null;

      return {
        mediaUrl,
        caption: this.nonEmpty(whatsappMessage.image?.caption),
        mimeType: this.nonEmpty(whatsappMessage.image?.mime_type),
      };
    }

    if (messageType === MessageType.AUDIO) {
      const mediaUrl = this.nonEmpty(whatsappMessage.audio?.link);
      if (!mediaUrl) return null;

      return {
        mediaUrl,
        mimeType: this.nonEmpty(whatsappMessage.audio?.mime_type),
      };
    }

    if (messageType === MessageType.VIDEO) {
      const mediaUrl = this.nonEmpty(whatsappMessage.video?.link);
      if (!mediaUrl) return null;

      return {
        mediaUrl,
        caption: this.nonEmpty(whatsappMessage.video?.caption),
        mimeType: this.nonEmpty(whatsappMessage.video?.mime_type),
      };
    }

    if (messageType === MessageType.DOCUMENT) {
      const mediaUrl = this.nonEmpty(whatsappMessage.document?.link);
      if (!mediaUrl) return null;

      return {
        mediaUrl,
        caption: this.nonEmpty(whatsappMessage.document?.caption),
        fileName: this.nonEmpty(whatsappMessage.document?.filename),
        mimeType: this.nonEmpty(whatsappMessage.document?.mime_type),
      };
    }

    return null;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeStatus(
    status: YCloudUpdatedWhatsappMessageDto['status'],
  ): WhatsappMessageStatus | null {
    const normalized = String(status).trim().toUpperCase();

    switch (normalized) {
      case 'ACCEPTED':
      case 'SENT':
      case 'DELIVERED':
      case 'READ':
      case 'FAILED':
        return normalized;
      default:
        return null;
    }
  }

  private shouldUpdate(
    current: string | null,
    next: WhatsappMessageStatus,
  ): boolean {
    const rank: Record<WhatsappMessageStatus, number> = {
      ACCEPTED: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: 99,
    };

    if (!current) return true;
    if (current === next) return false;

    if (next === 'FAILED') {
      return current !== 'READ';
    }

    const currentRank = rank[current as WhatsappMessageStatus] ?? 0;
    const nextRank = rank[next];

    return nextRank > currentRank;
  }

  private resolveProviderUpdateTime(
    event: YCloudMessageUpdatedEventDto,
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
    status: WhatsappMessageStatus,
  ): Date {
    const candidate =
      (status === 'READ' && whatsappMessage.readTime) ||
      (status === 'DELIVERED' && whatsappMessage.deliverTime) ||
      (status === 'SENT' && whatsappMessage.sendTime) ||
      whatsappMessage.createTime ||
      event.createTime;

    const parsed = candidate ? new Date(candidate) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private buildErrorPayload(
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
  ): Prisma.InputJsonValue | undefined {
    if (
      whatsappMessage.status !== 'FAILED' &&
      !whatsappMessage.errorCode &&
      !whatsappMessage.errorMessage &&
      !whatsappMessage.whatsappApiError
    ) {
      return undefined;
    }

    const whatsappApiError = whatsappMessage.whatsappApiError
      ? {
          message: whatsappMessage.whatsappApiError.message ?? null,
          type: whatsappMessage.whatsappApiError.type ?? null,
          code: whatsappMessage.whatsappApiError.code ?? null,
          fbtrace_id: whatsappMessage.whatsappApiError.fbtrace_id ?? null,
          error_data: whatsappMessage.whatsappApiError.error_data
            ? {
                messaging_product:
                  whatsappMessage.whatsappApiError.error_data
                    .messaging_product ?? null,
                details:
                  whatsappMessage.whatsappApiError.error_data.details ?? null,
              }
            : null,
        }
      : null;

    return {
      errorCode: whatsappMessage.errorCode ?? null,
      errorMessage: whatsappMessage.errorMessage ?? null,
      whatsappApiError,
    } as Prisma.InputJsonValue;
  }

  private resolveFailureReason(
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
  ): string {
    return (
      whatsappMessage.errorMessage ||
      whatsappMessage.whatsappApiError?.message ||
      (typeof whatsappMessage.errorCode !== 'undefined'
        ? `Provider error code ${whatsappMessage.errorCode}`
        : 'Provider reported FAILED status')
    );
  }
}
