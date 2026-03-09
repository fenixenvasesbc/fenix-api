import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import {
  RabbitmqService,
  type ConsumeDecision,
} from '../rabbitmq/rabbitmq.service';
import { InboundMessageService } from '../inbound-message/inbound-message.service';
import type { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';

@Injectable()
export class InboundMessageWorker implements OnModuleInit {
  private readonly logger = new Logger(InboundMessageWorker.name);

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly inboundMessageService: InboundMessageService,
  ) {}

  async onModuleInit() {
    const queue = process.env.RABBITMQ_QUEUE_INBOUND!;
    this.logger.log(`Starting inbound consumer on queue=${queue}`);

    await this.rabbit.consume(queue, async (msg) => this.handleMessage(msg));
  }

  private async handleMessage(msg: ConsumeMessage): Promise<ConsumeDecision> {
    const payload = this.safeJson(msg);
    const deaths = this.rabbit.getDeathCount(msg);

    try {
      if (!payload) {
        throw new Error('Invalid JSON payload');
      }

      const job = this.validateJob(payload);
      await this.inboundMessageService.process(job);

      return { action: 'ack' };
    } catch (err) {
      const decision = this.routeRetry(deaths);
      const target = 'routingKey' in decision ? decision.routingKey : '-';

      this.logger.error(
        `Inbound worker failed. deaths=${deaths}. action=${decision.action}:${target}. err=${String(err)}`,
      );

      return decision;
    }
  }

  private validateJob(payload: any): WebhookInboxJob {
    if (!payload?.providerEventId) throw new Error('Missing providerEventId');
    if (!payload?.eventType) throw new Error('Missing eventType');
    if (!payload?.payload) throw new Error('Missing payload');

    return payload as WebhookInboxJob;
  }

  private safeJson(msg: ConsumeMessage): any | null {
    try {
      return JSON.parse(msg.content.toString('utf8'));
    } catch {
      return null;
    }
  }

  private routeRetry(deaths: number): ConsumeDecision {
    const rk10s = process.env.RABBITMQ_RK_RETRY_10S!;
    const rk1m = process.env.RABBITMQ_RK_RETRY_1M!;
    const rk10m = process.env.RABBITMQ_RK_RETRY_10M!;
    const rkDead = process.env.RABBITMQ_RK_DEAD!;

    if (deaths <= 2) return { action: 'retry', routingKey: rk10s };
    if (deaths <= 5) return { action: 'retry', routingKey: rk1m };
    if (deaths <= 8) return { action: 'retry', routingKey: rk10m };
    return { action: 'dead', routingKey: rkDead };
  }
}
