import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import {
  RabbitmqService,
  type ConsumeDecision,
} from '../rabbitmq/rabbitmq.service';
import { ChatEventsService } from './chat-events.service';
import type { ChatEvent } from './chat-event.types';

@Injectable()
export class ChatEventsBridge implements OnModuleInit {
  private readonly logger = new Logger(ChatEventsBridge.name);

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async onModuleInit() {
    const queue = process.env.RABBITMQ_QUEUE_CHAT_EVENTS ?? 'chat.events.api';
    this.logger.log(`Starting chat events bridge on queue=${queue}`);

    await this.rabbit.consume(queue, async (msg) => this.handleMessage(msg));
  }

  private async handleMessage(msg: ConsumeMessage): Promise<ConsumeDecision> {
    const event = this.safeJson(msg);

    if (!this.isChatEvent(event)) {
      this.logger.warn('Invalid chat event ignored');
      return { action: 'ack' };
    }

    this.chatEvents.emitLocal(event);
    return { action: 'ack' };
  }

  private safeJson(msg: ConsumeMessage): unknown {
    try {
      return JSON.parse(msg.content.toString('utf8'));
    } catch {
      return null;
    }
  }

  private isChatEvent(value: unknown): value is ChatEvent {
    const event = value as Partial<ChatEvent>;

    return (
      !!event &&
      typeof event.id === 'string' &&
      typeof event.type === 'string' &&
      typeof event.accountId === 'string' &&
      typeof event.createdAt === 'string'
    );
  }
}
