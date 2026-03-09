import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqplib from 'amqplib';
import type { ConfirmChannel, ConsumeMessage, Options } from 'amqplib';

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;

export type ConsumeDecision =
  | { action: 'ack' }
  | { action: 'retry'; routingKey: string }
  | { action: 'dead'; routingKey: string };

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);

  private conn?: AmqpConnection;
  private ch?: ConfirmChannel;

  async onModuleInit() {
    const url = process.env.RABBITMQ_URL;
    if (!url) throw new Error('Missing env RABBITMQ_URL');

    await this.connectWithRetry(url);

    const prefetch = Number(process.env.RABBITMQ_PREFETCH ?? 15);
    await this.ch!.prefetch(prefetch);

    await this.assertTopology();

    this.logger.log(`RabbitMQ connected. prefetch=${prefetch}`);
  }

  async onModuleDestroy() {
    await this.safeClose();
  }

  private async connectWithRetry(url: string) {
    const delaysMs = [500, 1000, 2000, 5000, 10000];
    let attempt = 0;

    while (true) {
      try {
        this.conn = await amqplib.connect(url);

        this.conn.on('error', (err: unknown) => {
          this.logger.error(`RabbitMQ connection error: ${String(err)}`);
        });

        this.conn.on('close', () => {
          this.logger.warn('RabbitMQ connection closed.');
        });

        this.ch = await this.conn.createConfirmChannel();

        this.ch.on('error', (err: unknown) => {
          this.logger.error(`RabbitMQ channel error: ${String(err)}`);
        });

        this.ch.on('close', () => {
          this.logger.warn('RabbitMQ channel closed.');
        });

        return;
      } catch (err) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)];
        attempt += 1;
        this.logger.warn(
          `RabbitMQ connect failed (attempt ${attempt}). Retrying in ${delay}ms. ${String(err)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async safeClose() {
    try {
      await this.ch?.close();
    } catch {}
    try {
      await this.conn?.close();
    } catch {}
  }

  private async assertTopology() {
    const exchange = process.env.RABBITMQ_EXCHANGE;
    const dlx = process.env.RABBITMQ_DLX_EXCHANGE;

    const qMain = process.env.RABBITMQ_QUEUE_MAIN;
    const qRetry10s = process.env.RABBITMQ_QUEUE_RETRY_10S;
    const qRetry1m = process.env.RABBITMQ_QUEUE_RETRY_1M;
    const qRetry10m = process.env.RABBITMQ_QUEUE_RETRY_10M;
    const qDead = process.env.RABBITMQ_QUEUE_DEAD;
    const qInbound = process.env.RABBITMQ_QUEUE_INBOUND!;
    const qMessageUpdated = process.env.RABBITMQ_QUEUE_MESSAGE_UPDATED!;

    const rkInbound = process.env.RABBITMQ_RK_INBOUND!;
    const rkMessageUpdated = process.env.RABBITMQ_RK_MESSAGE_UPDATED!;

    const rkProcess = process.env.RABBITMQ_RK_PROCESS;
    const rkRetry10s = process.env.RABBITMQ_RK_RETRY_10S;
    const rkRetry1m = process.env.RABBITMQ_RK_RETRY_1M;
    const rkRetry10m = process.env.RABBITMQ_RK_RETRY_10M;
    const rkDead = process.env.RABBITMQ_RK_DEAD;

    const missing = [
      ['RABBITMQ_EXCHANGE', exchange],
      ['RABBITMQ_DLX_EXCHANGE', dlx],
      ['RABBITMQ_QUEUE_MAIN', qMain],
      ['RABBITMQ_QUEUE_RETRY_10S', qRetry10s],
      ['RABBITMQ_QUEUE_RETRY_1M', qRetry1m],
      ['RABBITMQ_QUEUE_RETRY_10M', qRetry10m],
      ['RABBITMQ_QUEUE_DEAD', qDead],
      ['RABBITMQ_QUEUE_INBOUND', qInbound],
      ['RABBITMQ_QUEUE_MESSAGE_UPDATED', qMessageUpdated],
      ['RABBITMQ_RK_INBOUND', rkInbound],
      ['RABBITMQ_RK_MESSAGE_UPDATED', rkMessageUpdated],
      ['RABBITMQ_RK_PROCESS', rkProcess],
      ['RABBITMQ_RK_RETRY_10S', rkRetry10s],
      ['RABBITMQ_RK_RETRY_1M', rkRetry1m],
      ['RABBITMQ_RK_RETRY_10M', rkRetry10m],
      ['RABBITMQ_RK_DEAD', rkDead],
    ].filter(([, v]) => !v);

    if (missing.length) {
      throw new Error(`Missing env vars: ${missing.map(([k]) => k).join(', ')}`);
    }

    await this.ch!.assertExchange(exchange!, 'topic', { durable: true });
    await this.ch!.assertExchange(dlx!, 'topic', { durable: true });

    // Cola principal: SIN depender de DLX fijo para retries
    await this.ch!.assertQueue(qMain!, {
      durable: true,
    });
    await this.ch!.bindQueue(qMain!, exchange!, rkProcess!);

    await this.ch!.assertQueue(qInbound, { durable: true });
    await this.ch!.bindQueue(qInbound, exchange!, rkInbound);

    await this.ch!.assertQueue(qMessageUpdated, { durable: true });
    await this.ch!.bindQueue(qMessageUpdated, exchange!, rkMessageUpdated);

    await this.ch!.assertQueue(qRetry10s!, {
      durable: true,
      arguments: {
        'x-message-ttl': 10_000,
        'x-dead-letter-exchange': exchange!,
        'x-dead-letter-routing-key': rkProcess!,
      },
    });
    await this.ch!.bindQueue(qRetry10s!, dlx!, rkRetry10s!);

    await this.ch!.assertQueue(qRetry1m!, {
      durable: true,
      arguments: {
        'x-message-ttl': 60_000,
        'x-dead-letter-exchange': exchange!,
        'x-dead-letter-routing-key': rkProcess!,
      },
    });
    await this.ch!.bindQueue(qRetry1m!, dlx!, rkRetry1m!);

    await this.ch!.assertQueue(qRetry10m!, {
      durable: true,
      arguments: {
        'x-message-ttl': 600_000,
        'x-dead-letter-exchange': exchange!,
        'x-dead-letter-routing-key': rkProcess!,
      },
    });
    await this.ch!.bindQueue(qRetry10m!, dlx!, rkRetry10m!);

    await this.ch!.assertQueue(qDead!, { durable: true });
    await this.ch!.bindQueue(qDead!, dlx!, rkDead!);
  }

  async publish(routingKey: string, payload: unknown) {
    const exchange = process.env.RABBITMQ_EXCHANGE;
    if (!exchange) throw new Error('Missing env RABBITMQ_EXCHANGE');
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    const body = Buffer.from(JSON.stringify(payload));

    await new Promise<void>((resolve, reject) => {
      this.ch!.publish(
        exchange,
        routingKey,
        body,
        {
          persistent: true,
          contentType: 'application/json',
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  async publishToDLX(routingKey: string, msg: ConsumeMessage) {
    const dlx = process.env.RABBITMQ_DLX_EXCHANGE;
    if (!dlx) throw new Error('Missing env RABBITMQ_DLX_EXCHANGE');
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    const properties: Options.Publish = {
      persistent: true,
      contentType: msg.properties.contentType ?? 'application/json',
      contentEncoding: msg.properties.contentEncoding,
      correlationId: msg.properties.correlationId,
      messageId: msg.properties.messageId,
      timestamp: msg.properties.timestamp,
      type: msg.properties.type,
      appId: msg.properties.appId,
      headers: {
        ...(msg.properties.headers ?? {}),
      },
    };

    await new Promise<void>((resolve, reject) => {
      this.ch!.publish(dlx, routingKey, msg.content, properties, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  getDeathCount(msg: ConsumeMessage): number {
    const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;
    const xDeath = headers['x-death'];

    if (!Array.isArray(xDeath)) return 0;

    return xDeath.reduce((acc: number, item: any) => {
      const count = typeof item?.count === 'number' ? item.count : 0;
      return acc + count;
    }, 0);
  }

  async consume(
    queue: string,
    handler: (msg: ConsumeMessage) => Promise<ConsumeDecision>,
  ) {
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    await this.ch.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        const decision = await handler(msg);

        if (decision.action === 'ack') {
          this.ch!.ack(msg);
          return;
        }

        if (decision.action === 'retry' || decision.action === 'dead') {
          await this.publishToDLX(decision.routingKey, msg);
          this.ch!.ack(msg);
          return;
        }

        this.ch!.ack(msg);
      } catch (err) {
        this.logger.error(`Unhandled consumer error. Sending to dead. ${String(err)}`);

        try {
          const rkDead = process.env.RABBITMQ_RK_DEAD;
          if (!rkDead) throw new Error('Missing env RABBITMQ_RK_DEAD');

          await this.publishToDLX(rkDead, msg);
          this.ch!.ack(msg);
        } catch (publishErr) {
          this.logger.error(`Failed to publish to DLX dead queue. ${String(publishErr)}`);
          this.ch!.nack(msg, false, false);
        }
      }
    });
  }
}