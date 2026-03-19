import { Injectable, Logger } from '@nestjs/common';
import {
  LeadStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import {
  NormalizedInbound,
  YCloudInboundPayload,
} from 'src/common/types/ycloud-inbound';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';

import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadLanguageResolverService: LeadLanguageResolverService,
  ) {}

  async process(job: WebhookInboxJob) {
    this.logger.log(
      `Processing inbound message job id=${job.providerEventId} type=${job.eventType}`,
    );

    const payload = job.payload as YCloudInboundPayload;
    const inbound = this.normalizeInbound(payload);

    const account = await this.prisma.account.findUnique({
      where: {
        wabaId_phoneE164: {
          wabaId: inbound.wabaId,
          phoneE164: inbound.to,
        },
      },
      select: {
        id: true,
      },
    });

    if (!account) {
      throw new Error(
        `Account not found for wabaId=${inbound.wabaId} phoneE164=${inbound.to}`,
      );
    }
    const resolvedPreferredLanguage =
      this.leadLanguageResolverService.resolveFromPhone(inbound.from) ??
      'es_ES';

    const lead = await this.prisma.lead.upsert({
      where: {
        accountId_phoneE164: {
          accountId: account.id,
          phoneE164: inbound.from,
        },
      },
      create: {
        accountId: account.id,
        phoneE164: inbound.from,
        name: inbound.senderName ?? undefined,
        status: LeadStatus.RESPONDED,
        firstInboundAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        lastInboundAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        respondedAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        lastMessageAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        preferredLanguage: resolvedPreferredLanguage,
      },
      update: {
        status: LeadStatus.RESPONDED,
        firstInboundAt: undefined,
        lastInboundAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        respondedAt: undefined,
        lastMessageAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
      },
      select: {
        id: true,
        status: true,
        firstInboundAt: true,
        respondedAt: true,
      },
    });

    if (!lead.firstInboundAt || !lead.respondedAt) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          firstInboundAt:
            lead.firstInboundAt ??
            inbound.providerSendTime ??
            inbound.providerCreateTime ??
            new Date(),
          respondedAt:
            lead.respondedAt ??
            inbound.providerSendTime ??
            inbound.providerCreateTime ??
            new Date(),
        },
      });
    }

    const responseTo = inbound.contextWamid
      ? await this.prisma.message.findFirst({
          where: {
            accountId: account.id,
            wamid: inbound.contextWamid,
          },
          select: { id: true, templateName: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    const interactivePayloadInput =
      inbound.interactivePayload === null
        ? undefined
        : (inbound.interactivePayload as Prisma.InputJsonValue);

    const referralPayloadInput =
      inbound.referralPayload === null
        ? undefined
        : (inbound.referralPayload as Prisma.InputJsonValue);

    const errorsInput =
      inbound.errors === null
        ? undefined
        : (inbound.errors as Prisma.InputJsonValue);

    await this.prisma.message.upsert({
      where: {
        accountId_ycloudMessageId: {
          accountId: account.id,
          ycloudMessageId: inbound.ycloudMessageId,
        },
      },
      create: {
        accountId: account.id,
        leadId: lead.id,
        direction: MessageDirection.INBOUND,
        type: inbound.type,
        status: MessageStatus.UNKNOWN,
        ycloudMessageId: inbound.ycloudMessageId,
        wamid: inbound.wamid,
        contextWamid: inbound.contextWamid,
        providerCreateTime: inbound.providerCreateTime,
        providerSendTime: inbound.providerSendTime,
        textBody: inbound.textBody,
        mediaUrl: inbound.mediaUrl,
        mimeType: inbound.mimeType,
        caption: inbound.caption,
        fileName: inbound.fileName,
        rawPayload: inbound.rawPayload as Prisma.InputJsonValue,
        responseToId: responseTo?.id ?? null,
        respondedAt:
          inbound.providerSendTime ?? inbound.providerCreateTime ?? new Date(),
        ...(interactivePayloadInput !== undefined && {
          interactivePayload: interactivePayloadInput,
        }),
        ...(referralPayloadInput !== undefined && {
          referralPayload: referralPayloadInput,
        }),
        ...(errorsInput !== undefined && {
          errors: errorsInput,
        }),
      },
      update: {
        textBody: inbound.textBody,
        mediaUrl: inbound.mediaUrl,
        mimeType: inbound.mimeType,
        caption: inbound.caption,
        fileName: inbound.fileName,
        rawPayload: inbound.rawPayload as Prisma.InputJsonValue,
        responseToId: responseTo?.id ?? undefined,
        ...(interactivePayloadInput !== undefined && {
          interactivePayload: interactivePayloadInput,
        }),
        ...(referralPayloadInput !== undefined && {
          referralPayload: referralPayloadInput,
        }),
        ...(errorsInput !== undefined && {
          errors: errorsInput,
        }),
      },
    });

    this.logger.log(
      `Inbound processed providerEventId=${inbound.providerEventId} accountId=${account.id} leadId=${lead.id} type=${inbound.type}`,
    );
  }

  private normalizeInbound(payload: YCloudInboundPayload): NormalizedInbound {
    if (payload.type !== 'whatsapp.inbound_message.received') {
      throw new Error(`Unsupported eventType=${payload.type}`);
    }

    const msg = payload.whatsappInboundMessage;
    if (!msg) {
      throw new Error('Missing whatsappInboundMessage');
    }

    if (!payload.id) throw new Error('Missing provider event id');
    if (!msg.id) throw new Error('Missing inbound message id');
    if (!msg.wabaId) throw new Error('Missing wabaId');
    if (!msg.from) throw new Error('Missing from');
    if (!msg.to) throw new Error('Missing to');

    const normalizedType = this.mapMessageType(msg.type);

    const media = this.extractMedia(msg);
    const textBody = this.extractTextBody(msg);
    const interactivePayload = this.extractInteractivePayload(msg);
    const referralPayload = msg.referral
      ? (msg.referral as Prisma.JsonValue)
      : null;
    const errors = msg.errors ? (msg.errors as Prisma.JsonValue) : null;

    return {
      providerEventId: payload.id,
      ycloudMessageId: msg.id,
      wamid: msg.wamid ?? null,
      contextWamid: msg.context?.id ?? msg.reaction?.message_id ?? null,
      wabaId: msg.wabaId,
      from: msg.from,
      to: msg.to,
      senderName: msg.customerProfile?.name ?? null,
      providerCreateTime: payload.createTime
        ? new Date(payload.createTime)
        : null,
      providerSendTime: msg.sendTime ? new Date(msg.sendTime) : null,
      type: normalizedType,
      textBody,
      mediaUrl: media.link,
      mimeType: media.mimeType,
      caption: media.caption,
      fileName: media.fileName,
      interactivePayload,
      referralPayload,
      errors,
      rawPayload: payload as Prisma.JsonValue,
    };
  }

  private mapMessageType(type?: string): MessageType {
    switch (type) {
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
        return MessageType.UNKNOWN;
    }
  }

  private extractTextBody(
    msg: NonNullable<YCloudInboundPayload['whatsappInboundMessage']>,
  ): string | null {
    if (msg.type === 'text') {
      return msg.text?.body ?? null;
    }

    if (msg.type === 'button') {
      return msg.button?.text ?? msg.button?.payload ?? null;
    }

    if (msg.type === 'reaction') {
      return msg.reaction?.emoji ?? null;
    }

    if (msg.type === 'interactive') {
      if (msg.interactive?.type === 'button_reply') {
        return (
          msg.interactive.button_reply?.title ??
          msg.interactive.button_reply?.id ??
          null
        );
      }

      if (msg.interactive?.type === 'list_reply') {
        return (
          msg.interactive.list_reply?.title ??
          msg.interactive.list_reply?.description ??
          msg.interactive.list_reply?.id ??
          null
        );
      }

      if (msg.interactive?.type === 'nfm_reply') {
        return (
          msg.interactive.nfm_reply?.body ??
          msg.interactive.nfm_reply?.name ??
          null
        );
      }
    }

    if (msg.type === 'unsupported') {
      return msg.errors?.[0]?.title ?? 'unsupported';
    }

    return null;
  }

  private extractInteractivePayload(
    msg: NonNullable<YCloudInboundPayload['whatsappInboundMessage']>,
  ): Prisma.JsonValue | null {
    if (msg.type === 'interactive' && msg.interactive) {
      return msg.interactive as Prisma.JsonValue;
    }

    if (msg.type === 'button' && msg.button) {
      return msg.button as Prisma.JsonValue;
    }

    if (msg.type === 'reaction' && msg.reaction) {
      return msg.reaction as Prisma.JsonValue;
    }

    return null;
  }

  private extractMedia(
    msg: NonNullable<YCloudInboundPayload['whatsappInboundMessage']>,
  ): {
    link: string | null;
    mimeType: string | null;
    caption: string | null;
    fileName: string | null;
  } {
    if (msg.type === 'image' && msg.image) {
      return {
        link: msg.image.link ?? null,
        mimeType: msg.image.mime_type ?? null,
        caption: msg.image.caption ?? null,
        fileName: null,
      };
    }

    if (msg.type === 'video' && msg.video) {
      return {
        link: msg.video.link ?? null,
        mimeType: msg.video.mime_type ?? null,
        caption: msg.video.caption ?? null,
        fileName: null,
      };
    }

    if (msg.type === 'audio' && msg.audio) {
      return {
        link: msg.audio.link ?? null,
        mimeType: msg.audio.mime_type ?? null,
        caption: null,
        fileName: null,
      };
    }

    if (msg.type === 'document' && msg.document) {
      return {
        link: msg.document.link ?? null,
        mimeType: msg.document.mime_type ?? null,
        caption: msg.document.caption ?? null,
        fileName: msg.document.filename ?? null,
      };
    }

    if (msg.type === 'sticker' && msg.sticker) {
      return {
        link: msg.sticker.link ?? null,
        mimeType: msg.sticker.mime_type ?? null,
        caption: null,
        fileName: null,
      };
    }

    return {
      link: null,
      mimeType: null,
      caption: null,
      fileName: null,
    };
  }
}