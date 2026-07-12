import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { ChatEvent, PublishChatEventInput } from './chat-event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { withLeadDisplayName } from '../../common/utils/lead-name';

@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private readonly events$ = new Subject<ChatEvent>();

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly prisma: PrismaService,
  ) {}

  stream(): Observable<ChatEvent> {
    return this.events$.asObservable();
  }

  emitLocal(event: ChatEvent) {
    this.events$.next(event);
  }

  async publish(input: PublishChatEventInput) {
    const payload = await this.enrichPayload(input);
    const event: ChatEvent = {
      id: input.id ?? randomUUID(),
      type: input.type,
      accountId: input.accountId,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      payload,
    };

    try {
      await this.rabbit.publish(this.resolveRoutingKey(), event);
    } catch (error) {
      this.logger.warn(
        `Failed to publish chat event type=${event.type} accountId=${event.accountId} error=${String(error)}`,
      );
    }
  }

  private resolveRoutingKey() {
    return process.env.RABBITMQ_RK_CHAT_EVENTS ?? 'chat.events';
  }

  private async enrichPayload(input: PublishChatEventInput) {
    const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
    if (
      !input.leadId ||
      !['message.created', 'conversation.updated'].includes(input.type)
    ) {
      return payload;
    }

    try {
      const [message, conversation] = await Promise.all([
        input.messageId
          ? this.prisma.message.findUnique({
              where: { id: input.messageId },
              select: {
                id: true,
                accountId: true,
                leadId: true,
                direction: true,
                type: true,
                status: true,
                textBody: true,
                mediaUrl: true,
                caption: true,
                mimeType: true,
                fileName: true,
                templateName: true,
                providerCreateTime: true,
                providerSendTime: true,
                deletedAt: true,
                deletedByProviderEventId: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : null,
        this.prisma.conversation.findUnique({
          where: {
            accountId_leadId_channel: {
              accountId: input.accountId,
              leadId: input.leadId,
              channel: 'WHATSAPP',
            },
          },
          include: {
            lead: true,
            lastMessage: true,
          },
        }),
      ]);

      if (message) payload.message = message;
      if (conversation) {
        payload.conversation = {
          ...conversation,
          lead: withLeadDisplayName(conversation.lead),
        };
      }
    } catch (error) {
      this.logger.warn(
        `Could not enrich chat event type=${input.type} accountId=${input.accountId} error=${String(error)}`,
      );
    }

    return payload;
  }
}
