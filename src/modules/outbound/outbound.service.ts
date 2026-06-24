import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { ChatPolicyService } from './chat-policy.service';
import { ChatEventsService } from '../chat-events/chat-events.service';

type IdempotencyExpectation = {
  leadId: string;
  type: MessageType;
  textBody?: string | null;
  templateName?: string | null;
  templateLang?: string | null;
  mediaUrl?: string | null;
  caption?: string | null;
  fileName?: string | null;
};

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ycloudService: YcloudService,
    private readonly conversationService: ConversationService,
    private readonly chatPolicyService: ChatPolicyService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  // =========================
  // TEMPLATE MESSAGE
  // =========================
  async sendTemplateMessage(input: {
    accountId: string;
    leadId: string;
    clientRequestId: string;
    templateName: string;
    languageCode?: string | null;
  }) {
    const { accountId, leadId, clientRequestId, templateName, languageCode } =
      input;

    const lead = await this.getLead(accountId, leadId);
    const finalLanguage = languageCode ?? lead.preferredLanguage ?? 'es_ES';
    const expectation: IdempotencyExpectation = {
      leadId,
      type: MessageType.TEMPLATE,
      templateName,
      templateLang: finalLanguage,
    };
    const existing = await this.getIdempotentReplay(
      accountId,
      clientRequestId,
      expectation,
    );
    if (existing) return existing;

    await this.chatPolicyService.assertCanSendTemplate({ accountId, leadId });
    const account = await this.getAccount(accountId);

    const externalId = randomUUID();
    const outboundAt = new Date();

    const draft = await this.createOutboundDraft({
      data: {
        accountId,
        leadId,
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        status: MessageStatus.UNKNOWN,
        externalId,
        templateName,
        templateLang: finalLanguage,
        providerCreateTime: outboundAt,
        rawPayload: {
          source: 'outbound-message-service',
          type: 'template.send.requested',
          templateName,
          languageCode: finalLanguage,
          externalId,
          clientRequestId,
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      expectation,
    });
    if (draft.kind === 'replay') return draft.response;
    const message = draft.message;

    try {
      const response = await this.ycloudService.sendTemplateMessage({
        accountId,
        to: lead.phoneE164!,
        from: account.phoneE164!,
        templateName,
        languageCode: finalLanguage,
        externalId,
      });

      const providerCreateTime = this.parseProviderDate(
        response.createTime,
        outboundAt,
      );

      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.ACCEPTED,
          ycloudMessageId: response.id ?? undefined,
          wamid: response.wamid ?? undefined,
          providerCreateTime,
          rawPayload: response as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          createdAt: true,
          providerCreateTime: true,
        },
      });

      const conversation = await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      await this.publishOutboundAcceptedEvent({
        accountId,
        leadId,
        messageId: updated.id,
        conversationId: conversation.id,
        type: MessageType.TEMPLATE,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
        idempotentReplay: false,
      };
    } catch (error: any) {
      await this.handleError(message.id, error);
      throw error;
    }
  }

  // =========================
  // TEXT MESSAGE
  // =========================
  async sendTextMessage(input: {
    accountId: string;
    leadId: string;
    clientRequestId: string;
    text: string;
  }) {
    const { accountId, leadId, clientRequestId, text } = input;

    if (!text?.trim()) {
      throw new BadRequestException('Text is required');
    }

    const finalText = text.trim();
    const expectation: IdempotencyExpectation = {
      leadId,
      type: MessageType.TEXT,
      textBody: finalText,
    };
    const existing = await this.getIdempotentReplay(
      accountId,
      clientRequestId,
      expectation,
    );
    if (existing) return existing;

    await this.chatPolicyService.assertCanSendText({ accountId, leadId });

    const lead = await this.getLead(accountId, leadId);
    const account = await this.getAccount(accountId);

    const externalId = randomUUID();
    const outboundAt = new Date();

    const draft = await this.createOutboundDraft({
      data: {
        accountId,
        leadId,
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.UNKNOWN,
        externalId,
        textBody: finalText,
        providerCreateTime: outboundAt,
        rawPayload: {
          source: 'outbound-message-service',
          type: 'text.send.requested',
          text,
          externalId,
          clientRequestId,
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      expectation,
    });
    if (draft.kind === 'replay') return draft.response;
    const message = draft.message;

    try {
      const response = await this.ycloudService.sendTextMessage({
        accountId,
        to: lead.phoneE164!,
        from: account.phoneE164!,
        text: finalText,
        externalId,
      });

      const providerCreateTime = this.parseProviderDate(
        response.createTime,
        outboundAt,
      );

      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.ACCEPTED,
          ycloudMessageId: response.id ?? undefined,
          wamid: response.wamid ?? undefined,
          providerCreateTime,
          rawPayload: response as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          createdAt: true,
          providerCreateTime: true,
        },
      });

      const conversation = await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      await this.publishOutboundAcceptedEvent({
        accountId,
        leadId,
        messageId: updated.id,
        conversationId: conversation.id,
        type: MessageType.TEXT,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
        idempotentReplay: false,
      };
    } catch (error: any) {
      await this.handleError(message.id, error);
      throw error;
    }
  }

  async sendMediaMessage(input: {
    accountId: string;
    leadId: string;
    clientRequestId: string;
    type: 'image' | 'document';
    mediaUrl: string;
    caption?: string | null;
    fileName?: string | null;
  }) {
    const {
      accountId,
      leadId,
      clientRequestId,
      type,
      mediaUrl,
      caption,
      fileName,
    } = input;

    if (!mediaUrl?.trim()) {
      throw new BadRequestException('mediaUrl is required');
    }

    if (type !== 'image' && type !== 'document') {
      throw new BadRequestException('Unsupported media type');
    }

    if (type === 'document' && !fileName?.trim()) {
      throw new BadRequestException(
        'fileName is required for document messages',
      );
    }

    const messageType =
      type === 'image' ? MessageType.IMAGE : MessageType.DOCUMENT;

    const finalCaption = caption?.trim() || null;
    const finalMediaUrl = mediaUrl.trim();
    const finalFileName = fileName?.trim() || null;
    const expectation: IdempotencyExpectation = {
      leadId,
      type: messageType,
      mediaUrl: finalMediaUrl,
      caption: finalCaption,
      fileName: type === 'document' ? finalFileName : null,
    };
    const existing = await this.getIdempotentReplay(
      accountId,
      clientRequestId,
      expectation,
    );
    if (existing) return existing;

    await this.chatPolicyService.assertCanSendText({ accountId, leadId });

    const lead = await this.getLead(accountId, leadId);
    const account = await this.getAccount(accountId);
    const externalId = randomUUID();
    const outboundAt = new Date();

    const draft = await this.createOutboundDraft({
      data: {
        accountId,
        leadId,
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: messageType,
        status: MessageStatus.UNKNOWN,
        externalId,
        mediaUrl: finalMediaUrl,
        caption: finalCaption,
        fileName: type === 'document' ? finalFileName : null,
        mimeType: type === 'image' ? 'image/jpeg' : 'application/pdf',
        providerCreateTime: outboundAt,
        rawPayload: {
          source: 'outbound-message-service',
          type: `${type}.send.requested`,
          mediaUrl: finalMediaUrl,
          caption: finalCaption,
          fileName: finalFileName,
          externalId,
          clientRequestId,
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      expectation,
    });
    if (draft.kind === 'replay') return draft.response;
    const message = draft.message;

    try {
      const response =
        type === 'image'
          ? await this.ycloudService.sendImageMessage({
              accountId,
              to: lead.phoneE164,
              from: account.phoneE164,
              imageUrl: finalMediaUrl,
              caption: finalCaption,
              externalId,
            })
          : await this.ycloudService.sendDocumentMessage({
              accountId,
              to: lead.phoneE164,
              from: account.phoneE164,
              documentUrl: finalMediaUrl,
              fileName: finalFileName!,
              caption: finalCaption,
              externalId,
            });

      const providerCreateTime = this.parseProviderDate(
        response.createTime,
        outboundAt,
      );

      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.ACCEPTED,
          ycloudMessageId: response.id ?? undefined,
          wamid: response.wamid ?? undefined,
          providerCreateTime,
          rawPayload: response as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          createdAt: true,
          providerCreateTime: true,
        },
      });

      const conversation = await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      await this.publishOutboundAcceptedEvent({
        accountId,
        leadId,
        messageId: updated.id,
        conversationId: conversation.id,
        type: messageType,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
        type: messageType,
        idempotentReplay: false,
      };
    } catch (error: any) {
      await this.handleError(message.id, error);
      throw error;
    }
  }

  // =========================
  // HELPERS
  // =========================

  private async createOutboundDraft(input: {
    data: Prisma.MessageUncheckedCreateInput;
    expectation: IdempotencyExpectation;
  }) {
    try {
      const message = await this.prisma.message.create({
        data: input.data,
        select: { id: true, createdAt: true },
      });

      return { kind: 'created' as const, message };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      const response = await this.getIdempotentReplay(
        input.data.accountId,
        input.data.clientRequestId!,
        input.expectation,
      );
      if (!response) throw error;

      return { kind: 'replay' as const, response };
    }
  }

  private async getIdempotentReplay(
    accountId: string,
    clientRequestId: string,
    expectation: IdempotencyExpectation,
  ) {
    const message = await this.prisma.message.findUnique({
      where: {
        accountId_clientRequestId: { accountId, clientRequestId },
      },
      select: {
        id: true,
        leadId: true,
        type: true,
        status: true,
        externalId: true,
        textBody: true,
        templateName: true,
        templateLang: true,
        mediaUrl: true,
        caption: true,
        fileName: true,
      },
    });

    if (!message) return null;

    const matches =
      message.leadId === expectation.leadId &&
      message.type === expectation.type &&
      message.textBody === (expectation.textBody ?? null) &&
      message.templateName === (expectation.templateName ?? null) &&
      message.templateLang === (expectation.templateLang ?? null) &&
      message.mediaUrl === (expectation.mediaUrl ?? null) &&
      message.caption === (expectation.caption ?? null) &&
      message.fileName === (expectation.fileName ?? null);

    if (!matches) {
      throw new ConflictException(
        'clientRequestId was already used for a different message',
      );
    }

    return {
      success: message.status !== MessageStatus.FAILED,
      messageId: message.id,
      externalId: message.externalId,
      status: message.status,
      type: message.type,
      idempotentReplay: true,
    };
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async getLead(accountId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: {
        id: true,
        phoneE164: true,
        preferredLanguage: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (!lead.phoneE164) {
      throw new BadRequestException('Lead has no phone');
    }

    return lead;
  }

  private async getAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        phoneE164: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (!account.phoneE164) {
      throw new BadRequestException('Account has no sender phone');
    }

    return account;
  }

  private parseProviderDate(value: unknown, fallback: Date): Date {
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? fallback : parsed;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? fallback : value;
    }

    return fallback;
  }

  private async handleError(messageId: string, error: any) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.FAILED,
        errors: {
          message: error?.message ?? 'Outbound failed',
          retryable: error?.retryable ?? false,
          statusCode: error?.statusCode ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async publishOutboundAcceptedEvent(input: {
    accountId: string;
    leadId: string;
    messageId: string;
    conversationId: string;
    type: MessageType;
  }) {
    await this.chatEvents.publish({
      type: 'message.created',
      accountId: input.accountId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      payload: {
        direction: MessageDirection.OUTBOUND,
        messageType: input.type,
        status: MessageStatus.ACCEPTED,
      },
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId: input.accountId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      payload: {
        reason: 'outbound_message',
      },
    });
  }
}
