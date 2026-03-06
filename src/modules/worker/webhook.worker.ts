import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { RabbitmqService, type ConsumeDecision } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class WebhookWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookWorker.name);

  constructor(private readonly rabbit: RabbitmqService) {}

  async onModuleInit() {
    const qMain = process.env.RABBITMQ_QUEUE_MAIN!;
    this.logger.log(`Starting consumer on queue=${qMain}`);

    await this.rabbit.consume(qMain, async (msg) => {
      return this.handleMessage(msg);
    });
  }

  private async handleMessage(msg: ConsumeMessage): Promise<ConsumeDecision> {
    const payload = this.safeJson(msg);
    const id = payload?.id ?? msg.properties.messageId ?? '(no id)';
    const deaths = this.rabbit.getDeathCount(msg);

    try {
      this.logger.log(`Received message: ${id} deaths=${deaths}`);

      if (!payload) {
        throw new Error('Invalid JSON payload');
      }

      // TODO:
      // 1) guardar en DB
      // 2) idempotencia
      // 3) dispatch por tipo de evento
      // 4) transiciones de estado

      // Simulación opcional de error para pruebas:
      // if (payload.fail === true) throw new Error('Forced failure');

      return { action: 'ack' };
    } catch (err) {
      const decision = this.routeRetry(deaths);
      const target = 'routingKey' in decision ? decision.routingKey : '-';

      this.logger.error(
        `Handler failed for id=${id}. deaths=${deaths}. action=${decision.action}:${target}. err=${String(err)}`,
      );

      return decision;
    }
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

    if (deaths <= 2) {
      return { action: 'retry', routingKey: rk10s };
    }

    if (deaths <= 5) {
      return { action: 'retry', routingKey: rk1m };
    }

    if (deaths <= 8) {
      return { action: 'retry', routingKey: rk10m };
    }

    return { action: 'dead', routingKey: rkDead };
  }
}