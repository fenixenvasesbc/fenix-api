import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationChannel,
  ConversationStatus,
  LeadStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
  WebhookEventStatus,
} from '@prisma/client';
import type { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudSmbHistoryEventDto,
  YCloudSmbHistoryInboundMessageDto,
  YCloudSmbHistoryWhatsappMessageDto,
} from 'src/common/types/ycloud-smb-history.dto';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { normalizeLeadName } from 'src/common/utils/lead-name';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { MessageMediaService } from '../message-media/message-media.service';

type MessageContent = Pick<
  Prisma.MessageUncheckedCreateInput,
  'textBody' | 'mediaUrl' | 'caption' | 'mimeType' | 'fileName'
>;

type ProcessResult = {
  isNewMessage: boolean;
  accountId: string;
  leadId: string;
  messageId: string;
  conversationId: string | null;
  direction: MessageDirection;
  messageType: MessageType;
  status: MessageStatus;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
};

@Injectable()
export class SmbHistoryService {
  private readonly logger = new Logger(SmbHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatEvents: ChatEventsService,
    private readonly leadLanguageResolver: LeadLanguageResolverService,
    private readonly messageMedia: MessageMediaService,
  ) {}

  async process(job: WebhookInboxJob): Promise<void> {
    this.logger.log(
      `Processing SMB history job providerEventId=${job.providerEventId} type=${job.eventType}`,
    );

    await this.markProcessing(job);

    const event = this.parseEvent(job.payload);
    const result = event.whatsappInboundMessage
      ? await this.processInboundHistory(
          job,
          event,
          event.whatsappInboundMessage,
        )
      : await this.processOutboundHistory(job, event, event.whatsappMessage!);

    if (result.mediaUrl) {
      await this.messageMedia.archiveMessageMedia({
        accountId: result.accountId,
        messageId: result.messageId,
        sourceUrl: result.mediaUrl,
        mimeType: result.mimeType,
        fileName: result.fileName,
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
          direction: result.direction,
          messageType: result.messageType,
          status: result.status,
          source: 'whatsapp_smb_history',
        },
      });

      await this.chatEvents.publish({
        type: 'conversation.updated',
        accountId: result.accountId,
        leadId: result.leadId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        payload: {
          reason: 'whatsapp_smb_history',
        },
      });
    }

    this.logger.log(
      `SMB history processed providerEventId=${job.providerEventId} accountId=${result.accountId} leadId=${result.leadId} messageId=${result.messageId} direction=${result.direction} created=${result.isNewMessage}`,
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

  private async processInboundHistory(
    job: WebhookInboxJob,
    event: YCloudSmbHistoryEventDto,
    inbound: YCloudSmbHistoryInboundMessageDto,
  ): Promise<ProcessResult> {
    const wabaId = this.nonEmpty(inbound.wabaId);
    const from = this.normalizePhone(inbound.from);
    const to = this.normalizePhone(inbound.to);
    const ycloudMessageId = this.nonEmpty(inbound.id);

    if (!wabaId || !from || !to || !ycloudMessageId) {
      throw new Error(
        `Missing inbound history identifiers providerEventId=${job.providerEventId}`,
      );
    }

    const messageType = this.mapMessageType(inbound.type);
    if (!messageType) {
      await this.markSkipped(job, 'UNSUPPORTED_INBOUND_HISTORY_TYPE');
      this.logger.warn(
        `SMB history inbound skipped unsupported type providerEventId=${job.providerEventId} type=${inbound.type ?? '-'}`,
      );
      return this.emptySkippedResult();
    }

    const content = this.extractContent(inbound, messageType);
    if (!content) {
      await this.markSkipped(job, 'MISSING_INBOUND_HISTORY_CONTENT');
      this.logger.warn(
        `SMB history inbound skipped missing content providerEventId=${job.providerEventId} type=${messageType}`,
      );
      return this.emptySkippedResult();
    }

    const account = await this.prisma.account.findUnique({
      where: { wabaId_phoneE164: { wabaId, phoneE164: to } },
      select: { id: true },
    });
    if (!account) {
      throw new Error(`Account not found for wabaId=${wabaId} phoneE164=${to}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const inboundAt =
        this.parseDate(inbound.sendTime) ??
        this.parseDate(event.createTime) ??
        new Date();
      const customerProfileName = normalizeLeadName(
        inbound.customerProfile?.name,
      );
      const customerUsername = this.nonEmpty(inbound.customerProfile?.username);
      const resolvedPreferredLanguage =
        this.leadLanguageResolver.resolveFromPhone(from) ?? 'es_ES';

      const lead = await tx.lead.upsert({
        where: {
          accountId_phoneE164: {
            accountId: account.id,
            phoneE164: from,
          },
        },
        create: {
          accountId: account.id,
          phoneE164: from,
          name: customerProfileName ?? undefined,
          whatsappProfileName: customerProfileName ?? undefined,
          whatsappUserId: this.nonEmpty(inbound.fromUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(inbound.fromParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
          status: LeadStatus.RESPONDED,
          firstInboundAt: inboundAt,
          lastInboundAt: inboundAt,
          respondedAt: inboundAt,
          lastMessageAt: inboundAt,
          preferredLanguage: resolvedPreferredLanguage,
        },
        update: {
          status: LeadStatus.RESPONDED,
          whatsappProfileName: customerProfileName ?? undefined,
          whatsappUserId: this.nonEmpty(inbound.fromUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(inbound.fromParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
        },
        select: {
          id: true,
          firstInboundAt: true,
          respondedAt: true,
          lastInboundAt: true,
          lastMessageAt: true,
        },
      });

      const leadInboundPatch: Prisma.LeadUpdateInput = {};
      if (!lead.firstInboundAt) leadInboundPatch.firstInboundAt = inboundAt;
      if (!lead.respondedAt) leadInboundPatch.respondedAt = inboundAt;
      if (!lead.lastInboundAt || inboundAt >= lead.lastInboundAt) {
        leadInboundPatch.lastInboundAt = inboundAt;
      }
      if (!lead.lastMessageAt || inboundAt >= lead.lastMessageAt) {
        leadInboundPatch.lastMessageAt = inboundAt;
      }

      if (Object.keys(leadInboundPatch).length > 0) {
        await tx.lead.update({
          where: { id: lead.id },
          data: leadInboundPatch,
        });
      }

      const existingMessage = await this.findExistingMessageTx(tx, {
        accountId: account.id,
        ycloudMessageId,
        wamid: this.nonEmpty(inbound.wamid),
        externalId: null,
      });

      if (existingMessage) {
        await tx.message.update({
          where: { id: existingMessage.id },
          data: {
            status: MessageStatus.UNKNOWN,
            providerSendTime: inboundAt,
            providerUpdateTime: inboundAt,
            wamid: this.nonEmpty(inbound.wamid) ?? undefined,
            contextWamid: this.nonEmpty(inbound.context?.id) ?? undefined,
            senderWhatsAppUserId:
              this.nonEmpty(inbound.fromUserId) ?? undefined,
            senderParentUserId:
              this.nonEmpty(inbound.fromParentUserId) ?? undefined,
            customerUsername: customerUsername ?? undefined,
            customerDisplayName: inbound.customerProfile?.name ?? undefined,
            rawPayload: job.payload as Prisma.InputJsonValue,
            ...content,
          },
        });

        await this.markProcessedTx(
          tx,
          job,
          account.id,
          lead.id,
          existingMessage.id,
        );

        return {
          isNewMessage: false,
          accountId: account.id,
          leadId: lead.id,
          messageId: existingMessage.id,
          conversationId: null,
          direction: MessageDirection.INBOUND,
          messageType,
          status: MessageStatus.UNKNOWN,
          mediaUrl: content.mediaUrl,
          mimeType: content.mimeType,
          fileName: content.fileName,
        };
      }

      const responseTo = inbound.context?.id
        ? await tx.message.findFirst({
            where: { accountId: account.id, wamid: inbound.context.id },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          })
        : null;

      const message = await tx.message.create({
        data: {
          accountId: account.id,
          leadId: lead.id,
          direction: MessageDirection.INBOUND,
          type: messageType,
          status: MessageStatus.UNKNOWN,
          ycloudMessageId,
          wamid: this.nonEmpty(inbound.wamid),
          contextWamid: this.nonEmpty(inbound.context?.id),
          senderWhatsAppUserId: this.nonEmpty(inbound.fromUserId),
          senderParentUserId: this.nonEmpty(inbound.fromParentUserId),
          customerUsername,
          customerDisplayName: inbound.customerProfile?.name ?? null,
          providerSendTime: inboundAt,
          providerUpdateTime: inboundAt,
          rawPayload: job.payload as Prisma.InputJsonValue,
          responseToId: responseTo?.id ?? null,
          ...content,
        },
        select: { id: true },
      });

      const conversation = await this.touchInboundHistoryTx(tx, {
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        inboundAt,
        incrementUnread: false,
      });

      await this.markProcessedTx(tx, job, account.id, lead.id, message.id);

      return {
        isNewMessage: true,
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        messageType,
        status: MessageStatus.UNKNOWN,
        mediaUrl: content.mediaUrl,
        mimeType: content.mimeType,
        fileName: content.fileName,
      };
    });
  }

  private async processOutboundHistory(
    job: WebhookInboxJob,
    event: YCloudSmbHistoryEventDto,
    outbound: YCloudSmbHistoryWhatsappMessageDto,
  ): Promise<ProcessResult> {
    const wabaId = this.nonEmpty(outbound.wabaId);
    const from = this.normalizePhone(outbound.from);
    const to = this.normalizePhone(outbound.to);
    const ycloudMessageId = this.nonEmpty(outbound.id);

    if (!wabaId || !from || !to || !ycloudMessageId) {
      throw new Error(
        `Missing outbound history identifiers providerEventId=${job.providerEventId}`,
      );
    }

    const messageType = this.mapMessageType(outbound.type);
    if (!messageType) {
      await this.markSkipped(job, 'UNSUPPORTED_OUTBOUND_HISTORY_TYPE');
      this.logger.warn(
        `SMB history outbound skipped unsupported type providerEventId=${job.providerEventId} type=${outbound.type ?? '-'}`,
      );
      return this.emptySkippedResult();
    }

    const content = this.extractContent(outbound, messageType);
    if (!content) {
      await this.markSkipped(job, 'MISSING_OUTBOUND_HISTORY_CONTENT');
      this.logger.warn(
        `SMB history outbound skipped missing content providerEventId=${job.providerEventId} type=${messageType}`,
      );
      return this.emptySkippedResult();
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

    return this.prisma.$transaction(async (tx) => {
      const outboundAt =
        this.parseDate(outbound.sendTime) ??
        this.parseDate(outbound.createTime) ??
        this.parseDate(event.createTime) ??
        new Date();
      const providerCreateTime = this.parseDate(outbound.createTime);
      const providerSendTime = this.parseDate(outbound.sendTime);
      const providerUpdateTime =
        this.parseDate(outbound.updateTime) ?? outboundAt;
      const status = this.normalizeStatus(outbound.status);
      const customerProfileName = normalizeLeadName(
        outbound.customerProfile?.name,
      );
      const customerUsername = this.nonEmpty(
        outbound.customerProfile?.username,
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
          name: customerProfileName ?? undefined,
          whatsappProfileName: customerProfileName ?? undefined,
          whatsappUserId: this.nonEmpty(outbound.toUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(outbound.toParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
          status: LeadStatus.NEW,
          firstOutboundAt: outboundAt,
          lastOutboundAt: outboundAt,
          lastMessageAt: outboundAt,
          preferredLanguage:
            this.leadLanguageResolver.resolveFromPhone(to) ?? undefined,
        },
        update: {
          whatsappProfileName: customerProfileName ?? undefined,
          whatsappUserId: this.nonEmpty(outbound.toUserId) ?? undefined,
          whatsappParentUserId:
            this.nonEmpty(outbound.toParentUserId) ?? undefined,
          whatsappUsername: customerUsername ?? undefined,
        },
        select: {
          id: true,
          firstOutboundAt: true,
          lastOutboundAt: true,
          lastMessageAt: true,
        },
      });

      const leadOutboundPatch: Prisma.LeadUpdateInput = {};
      if (!lead.firstOutboundAt) leadOutboundPatch.firstOutboundAt = outboundAt;
      if (!lead.lastOutboundAt || outboundAt >= lead.lastOutboundAt) {
        leadOutboundPatch.lastOutboundAt = outboundAt;
      }
      if (!lead.lastMessageAt || outboundAt >= lead.lastMessageAt) {
        leadOutboundPatch.lastMessageAt = outboundAt;
      }

      if (Object.keys(leadOutboundPatch).length > 0) {
        await tx.lead.update({
          where: { id: lead.id },
          data: leadOutboundPatch,
        });
      }

      const existingMessage = await this.findExistingMessageTx(tx, {
        accountId: account.id,
        ycloudMessageId,
        wamid: this.nonEmpty(outbound.wamid),
        externalId: this.nonEmpty(outbound.externalId),
      });

      if (existingMessage) {
        await tx.message.update({
          where: { id: existingMessage.id },
          data: {
            status,
            providerCreateTime: providerCreateTime ?? undefined,
            providerSendTime: providerSendTime ?? undefined,
            providerUpdateTime,
            wamid: this.nonEmpty(outbound.wamid) ?? undefined,
            externalId: this.nonEmpty(outbound.externalId) ?? undefined,
            recipientWhatsAppUserId:
              this.nonEmpty(outbound.toUserId) ?? undefined,
            recipientParentUserId:
              this.nonEmpty(outbound.toParentUserId) ?? undefined,
            customerUsername: customerUsername ?? undefined,
            customerDisplayName: outbound.customerProfile?.name ?? undefined,
            rawPayload: job.payload as Prisma.InputJsonValue,
            ...content,
          },
        });

        await this.markProcessedTx(
          tx,
          job,
          account.id,
          lead.id,
          existingMessage.id,
        );

        return {
          isNewMessage: false,
          accountId: account.id,
          leadId: lead.id,
          messageId: existingMessage.id,
          conversationId: null,
          direction: MessageDirection.OUTBOUND,
          messageType,
          status,
          mediaUrl: content.mediaUrl,
          mimeType: content.mimeType,
          fileName: content.fileName,
        };
      }

      const responseTo = outbound.context?.message_id
        ? await tx.message.findFirst({
            where: {
              accountId: account.id,
              wamid: outbound.context.message_id,
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
          wamid: this.nonEmpty(outbound.wamid),
          externalId: this.nonEmpty(outbound.externalId),
          recipientWhatsAppUserId: this.nonEmpty(outbound.toUserId),
          recipientParentUserId: this.nonEmpty(outbound.toParentUserId),
          customerUsername,
          customerDisplayName: outbound.customerProfile?.name ?? null,
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

      const conversation = await this.touchOutboundHistoryTx(tx, {
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        outboundAt,
      });

      await this.markProcessedTx(tx, job, account.id, lead.id, message.id);

      return {
        isNewMessage: true,
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        messageType,
        status,
        mediaUrl: content.mediaUrl,
        mimeType: content.mimeType,
        fileName: content.fileName,
      };
    });
  }

  private parseEvent(payload: unknown): YCloudSmbHistoryEventDto {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid SMB history payload');
    }

    const event = payload as YCloudSmbHistoryEventDto;
    if (event.type !== 'whatsapp.smb.history') {
      throw new Error(`Unexpected event type: ${String(event.type)}`);
    }
    if (!event.id) throw new Error('Missing event id');
    if (!event.createTime) throw new Error('Missing event createTime');
    if (!event.whatsappInboundMessage && !event.whatsappMessage) {
      throw new Error('Missing whatsappInboundMessage or whatsappMessage');
    }

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

  private async markProcessedTx(
    tx: Prisma.TransactionClient,
    job: WebhookInboxJob,
    accountId: string,
    leadId: string,
    messageId: string,
  ) {
    await tx.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId,
        leadId,
        messageId,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private async touchInboundHistoryTx(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      leadId: string;
      messageId: string;
      inboundAt: Date;
      incrementUnread?: boolean;
    },
  ) {
    const customerWindowExpiresAt = new Date(
      input.inboundAt.getTime() + 24 * 60 * 60 * 1000,
    );

    const existing = await tx.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId: input.accountId,
          leadId: input.leadId,
          channel: ConversationChannel.WHATSAPP,
        },
      },
      select: {
        id: true,
        lastMessageAt: true,
        lastInboundAt: true,
        customerWindowExpiresAt: true,
      },
    });

    if (!existing) {
      return tx.conversation.create({
        data: {
          accountId: input.accountId,
          leadId: input.leadId,
          channel: ConversationChannel.WHATSAPP,
          status: ConversationStatus.OPEN,
          lastMessageId: input.messageId,
          lastInboundMessageId: input.messageId,
          lastMessageAt: input.inboundAt,
          lastInboundAt: input.inboundAt,
          customerWindowExpiresAt,
          isCustomerWindowOpen: customerWindowExpiresAt.getTime() > Date.now(),
          requiresAttention: true,
          unreadCount: 0,
        },
      });
    }

    const isLatestMessage =
      !existing.lastMessageAt ||
      input.inboundAt.getTime() >= existing.lastMessageAt.getTime();
    const isLatestInbound =
      !existing.lastInboundAt ||
      input.inboundAt.getTime() >= existing.lastInboundAt.getTime();
    const shouldExtendWindow =
      !existing.customerWindowExpiresAt ||
      customerWindowExpiresAt.getTime() >
        existing.customerWindowExpiresAt.getTime();

    return tx.conversation.update({
      where: { id: existing.id },
      data: {
        status: ConversationStatus.OPEN,
        closedAt: null,
        ...(isLatestInbound && {
          lastInboundMessageId: input.messageId,
          lastInboundAt: input.inboundAt,
        }),
        ...(shouldExtendWindow && {
          customerWindowExpiresAt,
          isCustomerWindowOpen: customerWindowExpiresAt.getTime() > Date.now(),
        }),
        ...(isLatestMessage && {
          lastMessageId: input.messageId,
          lastMessageAt: input.inboundAt,
          requiresAttention: true,
        }),
      },
    });
  }

  private async touchOutboundHistoryTx(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      leadId: string;
      messageId: string;
      outboundAt: Date;
    },
  ) {
    const existing = await tx.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId: input.accountId,
          leadId: input.leadId,
          channel: ConversationChannel.WHATSAPP,
        },
      },
      select: {
        id: true,
        lastMessageAt: true,
        lastOutboundAt: true,
        customerWindowExpiresAt: true,
      },
    });

    if (!existing) {
      return tx.conversation.create({
        data: {
          accountId: input.accountId,
          leadId: input.leadId,
          channel: ConversationChannel.WHATSAPP,
          status: ConversationStatus.OPEN,
          lastMessageId: input.messageId,
          lastOutboundMessageId: input.messageId,
          lastMessageAt: input.outboundAt,
          lastOutboundAt: input.outboundAt,
          isCustomerWindowOpen: false,
          requiresAttention: false,
          unreadCount: 0,
        },
      });
    }

    const isLatestMessage =
      !existing.lastMessageAt ||
      input.outboundAt.getTime() >= existing.lastMessageAt.getTime();
    const isLatestOutbound =
      !existing.lastOutboundAt ||
      input.outboundAt.getTime() >= existing.lastOutboundAt.getTime();
    const isCustomerWindowOpen = existing.customerWindowExpiresAt
      ? existing.customerWindowExpiresAt.getTime() > Date.now()
      : false;

    return tx.conversation.update({
      where: { id: existing.id },
      data: {
        status: ConversationStatus.OPEN,
        closedAt: null,
        isCustomerWindowOpen,
        ...(isLatestOutbound && {
          lastOutboundMessageId: input.messageId,
          lastOutboundAt: input.outboundAt,
        }),
        ...(isLatestMessage && {
          lastMessageId: input.messageId,
          lastMessageAt: input.outboundAt,
          requiresAttention: false,
          unreadCount: 0,
        }),
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
    message:
      | YCloudSmbHistoryInboundMessageDto
      | YCloudSmbHistoryWhatsappMessageDto,
    messageType: MessageType,
  ): MessageContent | null {
    if (messageType === MessageType.TEXT) {
      const textBody = this.nonEmpty(message.text?.body);
      return textBody ? { textBody } : null;
    }

    if (messageType === MessageType.IMAGE) {
      return {
        mediaUrl: this.nonEmpty(message.image?.link),
        caption: this.nonEmpty(message.image?.caption),
        mimeType: this.nonEmpty(message.image?.mime_type),
      };
    }

    if (messageType === MessageType.AUDIO) {
      return {
        mediaUrl: this.nonEmpty(message.audio?.link),
        mimeType: this.nonEmpty(message.audio?.mime_type),
      };
    }

    if (messageType === MessageType.VIDEO) {
      return {
        mediaUrl: this.nonEmpty(message.video?.link),
        caption: this.nonEmpty(message.video?.caption),
        mimeType: this.nonEmpty(message.video?.mime_type),
      };
    }

    if (messageType === MessageType.DOCUMENT) {
      return {
        mediaUrl: this.nonEmpty(message.document?.link),
        caption: this.nonEmpty(message.document?.caption),
        fileName: this.nonEmpty(message.document?.filename),
        mimeType: this.nonEmpty(message.document?.mime_type),
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

  private emptySkippedResult(): ProcessResult {
    return {
      isNewMessage: false,
      accountId: '-',
      leadId: '-',
      messageId: '-',
      conversationId: null,
      direction: MessageDirection.INBOUND,
      messageType: MessageType.TEXT,
      status: MessageStatus.UNKNOWN,
    };
  }
}
