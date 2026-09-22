import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationChannel,
  LeadStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
  WebhookEventStatus,
} from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudSmbEchoWhatsappMessageDto,
  YCloudSmbMessageEchoesEventDto,
} from 'src/common/types/ycloud-smb-message-echoes.dto';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { normalizeLeadName } from 'src/common/utils/lead-name';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';
import { MessageMediaService } from '../message-media/message-media.service';

type MessageContent = Pick<
  Prisma.MessageUncheckedCreateInput,
  'textBody' | 'mediaUrl' | 'caption' | 'mimeType' | 'fileName'
>;

@Injectable()
export class SmbMessageEchoesService {
  private readonly logger = new Logger(SmbMessageEchoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly chatEvents: ChatEventsService,
    private readonly leadLanguageResolver: LeadLanguageResolverService,
    private readonly messageMedia: MessageMediaService,
  ) {}

  async process(job: WebhookInboxJob): Promise<void> {
    this.logger.log(
      `Processing SMB message echoes job providerEventId=${job.providerEventId} type=${job.eventType}`,
    );

    await this.markProcessing(job);

    const event = this.parseEvent(job.payload);
    const whatsappMessage = event.whatsappMessage;

    const wabaId = this.nonEmpty(whatsappMessage.wabaId);
    const from = this.normalizePhone(whatsappMessage.from);
    const to = this.normalizePhone(whatsappMessage.to);
    const ycloudMessageId = this.nonEmpty(whatsappMessage.id);

    if (!wabaId || !from || !to || !ycloudMessageId) {
      throw new Error(
        `Missing whatsappMessage identifiers providerEventId=${job.providerEventId}`,
      );
    }

    if (whatsappMessage.type === 'edit') {
      await this.tryApplyEdit(job, event, {
        wabaId,
        from,
        to,
      });
      return;
    }

    const messageType = this.mapMessageType(whatsappMessage.type);
    if (!messageType) {
      await this.markSkipped(job, 'UNSUPPORTED_MESSAGE_TYPE');
      this.logger.warn(
        `SMB echo skipped unsupported type providerEventId=${job.providerEventId} type=${whatsappMessage.type ?? '-'}`,
      );
      return;
    }

    const content = this.extractContent(whatsappMessage, messageType);
    if (!content) {
      await this.markSkipped(job, 'MISSING_MESSAGE_CONTENT');
      this.logger.warn(
        `SMB echo skipped missing content providerEventId=${job.providerEventId} type=${messageType}`,
      );
      return;
    }

    const account = await this.prisma.account.findUnique({
      where: {
        wabaId_phoneE164: {
          wabaId,
          phoneE164: from,
        },
      },
      select: { id: true },
    });

    if (!account) {
      throw new Error(
        `Account not found for wabaId=${wabaId} phoneE164=${from}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existingMessage = await this.findExistingMessageTx(tx, {
        accountId: account.id,
        ycloudMessageId,
        wamid: this.nonEmpty(whatsappMessage.wamid),
        externalId: this.nonEmpty(whatsappMessage.externalId),
      });

      const outboundAt =
        this.parseDate(whatsappMessage.sendTime) ??
        this.parseDate(whatsappMessage.createTime) ??
        this.parseDate(event.createTime) ??
        new Date();
      const providerCreateTime = this.parseDate(whatsappMessage.createTime);
      const providerSendTime = this.parseDate(whatsappMessage.sendTime);
      const providerUpdateTime =
        this.parseDate(whatsappMessage.updateTime) ?? outboundAt;
      const status = this.normalizeStatus(whatsappMessage.status);
      const customerUsername = this.nonEmpty(
        whatsappMessage.customerProfile?.username,
      );
      const customerDisplayName = normalizeLeadName(
        whatsappMessage.customerProfile?.name,
      );

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
          name: customerDisplayName ?? undefined,
          whatsappProfileName: customerDisplayName ?? undefined,
          whatsappUserId: this.nonEmpty(whatsappMessage.toUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(whatsappMessage.toParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
          status: LeadStatus.NEW,
          firstOutboundAt: outboundAt,
          lastOutboundAt: outboundAt,
          lastMessageAt: outboundAt,
          preferredLanguage:
            this.leadLanguageResolver.resolveFromPhone(to) ?? undefined,
        },
        update: {
          whatsappProfileName: customerDisplayName ?? undefined,
          whatsappUserId: this.nonEmpty(whatsappMessage.toUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(whatsappMessage.toParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
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

      if (existingMessage) {
        await tx.message.update({
          where: { id: existingMessage.id },
          data: {
            status,
            providerCreateTime: providerCreateTime ?? undefined,
            providerSendTime: providerSendTime ?? undefined,
            providerUpdateTime,
            wamid: this.nonEmpty(whatsappMessage.wamid) ?? undefined,
            externalId: this.nonEmpty(whatsappMessage.externalId) ?? undefined,
            recipientWhatsAppUserId:
              this.nonEmpty(whatsappMessage.toUserId) ?? undefined,
            recipientParentUserId:
              this.nonEmpty(whatsappMessage.toParentUserId) ?? undefined,
            customerUsername: customerUsername ?? undefined,
            customerDisplayName:
              whatsappMessage.customerProfile?.name ?? undefined,
            rawPayload: job.payload as Prisma.InputJsonValue,
            ...content,
          },
        });

        await tx.webhookEvent.updateMany({
          where: { providerEventId: job.providerEventId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            accountId: account.id,
            leadId: lead.id,
            messageId: existingMessage.id,
            processedAt: new Date(),
            lastError: null,
          },
        });

        return {
          isNewMessage: false,
          accountId: account.id,
          leadId: lead.id,
          messageId: existingMessage.id,
          conversationId: null as string | null,
          messageType,
          status,
        };
      }

      const responseTo = whatsappMessage.context?.message_id
        ? await tx.message.findFirst({
            where: {
              accountId: account.id,
              wamid: whatsappMessage.context.message_id,
            },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          })
        : null;

      const message = await tx.message.create({
        data: {
          accountId: account.id,
          leadId: lead.id,
          direction: MessageDirection.OUTBOUND,
          type: messageType,
          status,
          ycloudMessageId,
          wamid: this.nonEmpty(whatsappMessage.wamid),
          externalId: this.nonEmpty(whatsappMessage.externalId),
          recipientWhatsAppUserId: this.nonEmpty(whatsappMessage.toUserId),
          recipientParentUserId: this.nonEmpty(whatsappMessage.toParentUserId),
          customerUsername,
          customerDisplayName: whatsappMessage.customerProfile?.name ?? null,
          providerCreateTime,
          providerSendTime,
          providerUpdateTime,
          rawPayload: job.payload as Prisma.InputJsonValue,
          responseToId: responseTo?.id ?? null,
          ...content,
        },
        select: { id: true },
      });

      await tx.messageStatusHistory.create({
        data: {
          messageId: message.id,
          fromStatus: null,
          toStatus: status,
          providerEventId: job.providerEventId,
          providerTime: providerSendTime ?? providerCreateTime ?? outboundAt,
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
          status: WebhookEventStatus.PROCESSED,
          accountId: account.id,
          leadId: lead.id,
          messageId: message.id,
          processedAt: new Date(),
          lastError: null,
        },
      });

      return {
        isNewMessage: true,
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        conversationId: conversation.id,
        messageType,
        status,
      };
    });

    if (content.mediaUrl) {
      await this.messageMedia.archiveMessageMedia({
        accountId: result.accountId,
        messageId: result.messageId,
        sourceUrl: content.mediaUrl,
        mimeType: content.mimeType,
        fileName: content.fileName,
        messageType: result.messageType,
        providerEventId: job.providerEventId,
      });
    }

    if (result.isNewMessage && result.conversationId) {
      await this.chatEvents.publish({
        type: 'message.created',
        accountId: result.accountId,
        leadId: result.leadId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        payload: {
          direction: MessageDirection.OUTBOUND,
          messageType: result.messageType,
          status: result.status,
          source: 'whatsapp_smb_message_echoes',
        },
      });

      await this.chatEvents.publish({
        type: 'conversation.updated',
        accountId: result.accountId,
        leadId: result.leadId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        payload: {
          reason: 'whatsapp_smb_message_echoes',
        },
      });
    }

    this.logger.log(
      `SMB echo processed providerEventId=${job.providerEventId} accountId=${result.accountId} leadId=${result.leadId} messageId=${result.messageId} created=${result.isNewMessage}`,
    );
  }

  // El comercial edito, desde la app de WhatsApp Business (no via API), un
  // mensaje saliente que ya habia enviado. YCloud manda el wamid del mensaje
  // original en edit.originalMessageId, asi que lo ubicamos de forma exacta
  // (misma logica que el edit de mensajes entrantes en InboundMessageService).
  private async tryApplyEdit(
    job: WebhookInboxJob,
    event: YCloudSmbMessageEchoesEventDto,
    input: { wabaId: string; from: string; to: string },
  ): Promise<void> {
    const { wabaId, from, to } = input;
    const whatsappMessage = event.whatsappMessage;
    const originalMessageId = this.nonEmpty(
      whatsappMessage.edit?.originalMessageId,
    );
    const editedTextBody = this.nonEmpty(
      whatsappMessage.edit?.message?.text?.body,
    );

    if (!originalMessageId) {
      this.logger.warn(
        `SMB edit missing originalMessageId providerEventId=${job.providerEventId}`,
      );
      await this.markSkipped(job, 'EDIT_MISSING_ORIGINAL_MESSAGE_ID');
      return;
    }

    const account = await this.prisma.account.findUnique({
      where: { wabaId_phoneE164: { wabaId, phoneE164: from } },
      select: { id: true },
    });

    if (!account) {
      throw new Error(
        `Account not found for wabaId=${wabaId} phoneE164=${from}`,
      );
    }

    const editedAt =
      this.parseDate(whatsappMessage.sendTime) ??
      this.parseDate(whatsappMessage.createTime) ??
      this.parseDate(event.createTime) ??
      new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.message.findFirst({
        where: {
          accountId: account.id,
          direction: MessageDirection.OUTBOUND,
          wamid: originalMessageId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          leadId: true,
          textBody: true,
          originalTextBody: true,
        },
      });

      if (!original) return null;

      await tx.message.update({
        where: { id: original.id },
        data: {
          textBody: editedTextBody,
          originalTextBody: original.originalTextBody ?? original.textBody,
          editedAt,
          editedByProviderEventId: job.providerEventId,
        },
      });

      const conversation = await tx.conversation.findUnique({
        where: {
          accountId_leadId_channel: {
            accountId: account.id,
            leadId: original.leadId,
            channel: ConversationChannel.WHATSAPP,
          },
        },
        select: { id: true },
      });

      await tx.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          accountId: account.id,
          leadId: original.leadId,
          messageId: original.id,
          processedAt: new Date(),
          lastError: null,
        },
      });

      return {
        accountId: account.id,
        leadId: original.leadId,
        messageId: original.id,
        conversationId: conversation?.id ?? null,
      };
    });

    if (!result) {
      this.logger.warn(
        `SMB edit not matched: original message not found providerEventId=${job.providerEventId} accountId=${account.id} to=${to} originalMessageId=${originalMessageId}`,
      );
      await this.markSkipped(job, 'EDIT_ORIGINAL_MESSAGE_NOT_FOUND');
      return;
    }

    await this.chatEvents.publish({
      type: 'message.updated',
      accountId: result.accountId,
      leadId: result.leadId,
      conversationId: result.conversationId,
      messageId: result.messageId,
      payload: {
        reason: 'message_edited',
        editedAt: editedAt.toISOString(),
        providerEventId: job.providerEventId,
        source: 'whatsapp_smb_message_echoes',
      },
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId: result.accountId,
      leadId: result.leadId,
      conversationId: result.conversationId,
      messageId: result.messageId,
      payload: {
        reason: 'message_edited',
        source: 'whatsapp_smb_message_echoes',
      },
    });

    this.logger.log(
      `SMB echo edit processed providerEventId=${job.providerEventId} accountId=${result.accountId} leadId=${result.leadId} messageId=${result.messageId}`,
    );
  }

  async markFailed(job: WebhookInboxJob, error: unknown, dead = false) {
    const now = new Date();

    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: dead ? WebhookEventStatus.DEAD : WebhookEventStatus.FAILED,
        lastAttemptAt: now,
        deadAt: dead ? now : undefined,
        lastError: this.formatError(error),
      },
    });
  }

  private parseEvent(payload: unknown): YCloudSmbMessageEchoesEventDto {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid SMB message echoes payload');
    }

    const event = payload as YCloudSmbMessageEchoesEventDto;
    if (event.type !== 'whatsapp.smb.message.echoes') {
      throw new Error(`Unexpected event type: ${String(event.type)}`);
    }
    if (!event.id) throw new Error('Missing event id');
    if (!event.createTime) throw new Error('Missing event createTime');
    if (!event.whatsappMessage) throw new Error('Missing whatsappMessage');
    if (!event.whatsappMessage.id)
      throw new Error('Missing whatsappMessage.id');

    return event;
  }

  private async markProcessing(job: WebhookInboxJob) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSING,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
      },
    });
  }

  private async markSkipped(job: WebhookInboxJob, reason: string) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt: new Date(),
        lastError: reason,
      },
    });
  }

  private async findExistingMessageTx(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      ycloudMessageId: string;
      wamid: string | null;
      externalId: string | null;
    },
  ) {
    const byYcloudId = await tx.message.findUnique({
      where: {
        accountId_ycloudMessageId: {
          accountId: input.accountId,
          ycloudMessageId: input.ycloudMessageId,
        },
      },
      select: { id: true },
    });
    if (byYcloudId) return byYcloudId;

    if (input.wamid) {
      const byWamid = await tx.message.findFirst({
        where: { accountId: input.accountId, wamid: input.wamid },
        select: { id: true },
      });
      if (byWamid) return byWamid;
    }

    if (input.externalId) {
      const byExternalId = await tx.message.findFirst({
        where: { accountId: input.accountId, externalId: input.externalId },
        select: { id: true },
      });
      if (byExternalId) return byExternalId;
    }

    return null;
  }

  private mapMessageType(type?: string): MessageType | null {
    switch (this.nonEmpty(type)?.toLowerCase()) {
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

  private normalizeStatus(status?: string): MessageStatus {
    switch (this.nonEmpty(status)?.toUpperCase()) {
      case 'ACCEPTED':
        return MessageStatus.ACCEPTED;
      case 'DELIVERED':
        return MessageStatus.DELIVERED;
      case 'READ':
        return MessageStatus.READ;
      case 'FAILED':
        return MessageStatus.FAILED;
      case 'SENT':
      default:
        return MessageStatus.SENT;
    }
  }

  private extractContent(
    whatsappMessage: YCloudSmbEchoWhatsappMessageDto,
    messageType: MessageType,
  ): MessageContent | null {
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

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizePhone(value: unknown): string | null {
    const phone = this.nonEmpty(value);
    if (!phone) return null;
    return phone.startsWith('+') ? phone : `+${phone}`;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
