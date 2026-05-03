import {
  BadRequestException,
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
import { PrismaService } from 'src/prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { ChatPolicyService } from './chat-policy.service';

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ycloudService: YcloudService,
    private readonly conversationService: ConversationService,
    private readonly chatPolicyService: ChatPolicyService,
  ) {}

  // =========================
  // TEMPLATE MESSAGE
  // =========================
  async sendTemplateMessage(input: {
    accountId: string;
    leadId: string;
    templateName: string;
    languageCode?: string | null;
  }) {
    const { accountId, leadId, templateName, languageCode } = input;

    await this.chatPolicyService.assertCanSendTemplate({
      accountId,
      leadId,
    });

    const lead = await this.getLead(accountId, leadId);
    const account = await this.getAccount(accountId);

    const finalLanguage = languageCode ?? lead.preferredLanguage ?? 'es_ES';

    const externalId = randomUUID();
    const outboundAt = new Date();

    const message = await this.prisma.message.create({
      data: {
        accountId,
        leadId,
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
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });

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

      await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
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
    text: string;
  }) {
    const { accountId, leadId, text } = input;

    if (!text?.trim()) {
      throw new BadRequestException('Text is required');
    }

    await this.chatPolicyService.assertCanSendText({
      accountId,
      leadId,
    });

    const lead = await this.getLead(accountId, leadId);
    const account = await this.getAccount(accountId);

    const externalId = randomUUID();
    const outboundAt = new Date();

    const message = await this.prisma.message.create({
      data: {
        accountId,
        leadId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.UNKNOWN,
        externalId,
        textBody: text.trim(),
        providerCreateTime: outboundAt,
        rawPayload: {
          source: 'outbound-message-service',
          type: 'text.send.requested',
          text,
          externalId,
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });

    try {
      const response = await this.ycloudService.sendTextMessage({
        accountId,
        to: lead.phoneE164!,
        from: account.phoneE164!,
        text: text.trim(),
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

      await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
      };
    } catch (error: any) {
      await this.handleError(message.id, error);
      throw error;
    }
  }

  async sendMediaMessage(input: {
    accountId: string;
    leadId: string;
    type: 'image' | 'document';
    mediaUrl: string;
    caption?: string | null;
    fileName?: string | null;
  }) {
    const { accountId, leadId, type, mediaUrl, caption, fileName } = input;

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

    await this.chatPolicyService.assertCanSendText({
      accountId,
      leadId,
    });

    const lead = await this.getLead(accountId, leadId);
    const account = await this.getAccount(accountId);

    const externalId = randomUUID();
    const outboundAt = new Date();

    const messageType =
      type === 'image' ? MessageType.IMAGE : MessageType.DOCUMENT;

    const finalCaption = caption?.trim() || null;
    const finalMediaUrl = mediaUrl.trim();
    const finalFileName = fileName?.trim() || null;

    const message = await this.prisma.message.create({
      data: {
        accountId,
        leadId,
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
          requestedAt: outboundAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

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

      await this.conversationService.touchOutbound({
        accountId,
        leadId,
        messageId: updated.id,
        outboundAt: updated.providerCreateTime ?? updated.createdAt,
      });

      return {
        success: true,
        messageId: updated.id,
        externalId,
        status: MessageStatus.ACCEPTED,
        type: messageType,
      };
    } catch (error: any) {
      await this.handleError(message.id, error);
      throw error;
    }
  }

  // =========================
  // HELPERS
  // =========================

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
}
