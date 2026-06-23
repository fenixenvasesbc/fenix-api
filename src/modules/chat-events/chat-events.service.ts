import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { ChatEvent, PublishChatEventInput } from './chat-event.types';

@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private readonly events$ = new Subject<ChatEvent>();

  constructor(private readonly rabbit: RabbitmqService) {}

  stream(): Observable<ChatEvent> {
    return this.events$.asObservable();
  }

  emitLocal(event: ChatEvent) {
    this.events$.next(event);
  }

  async publish(input: PublishChatEventInput) {
    const event: ChatEvent = {
      id: input.id ?? randomUUID(),
      type: input.type,
      accountId: input.accountId,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      payload: input.payload,
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
}
