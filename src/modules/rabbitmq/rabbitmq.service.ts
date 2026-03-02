import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqplib from 'amqplib';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;

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
    const delaysMs = [500, 1000, 2000, 5000, 10000]; // backoff simple
    let attempt = 0;

    while (true) {
      try {
        this.conn = await amqplib.connect(url);

        // eventos útiles
        this.conn.on('error', (err: unknown) => {
          this.logger.error(`RabbitMQ connection error: ${String(err)}`);
        });

        this.conn.on('close', () => {
          this.logger.warn('RabbitMQ connection closed.');
          // Nota: en Nest dev/watch suele reiniciar; si quieres auto-reconnect en caliente,
          // se puede implementar aquí con un guard (para no crear loops).
        });

        // ConfirmChannel para publish confiable
        this.ch = await this.conn.createConfirmChannel();

        // si el channel cierra, lo logueamos
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
    const exchange = process.env.RABBITMQ_EXCHANGE; // ycloud.events
    const dlx = process.env.RABBITMQ_DLX_EXCHANGE; // ycloud.dlx

    const qMain = process.env.RABBITMQ_QUEUE_MAIN; // q_webhook_main
    const qRetry10s = process.env.RABBITMQ_QUEUE_RETRY_10S; // q_retry_10s
    const qRetry1m = process.env.RABBITMQ_QUEUE_RETRY_1M;
    const qRetry10m = process.env.RABBITMQ_QUEUE_RETRY_10M;
    const qDead = process.env.RABBITMQ_QUEUE_DEAD; // q_webhook_dead

    const rkProcess = process.env.RABBITMQ_RK_PROCESS; // webhook.process
    const rkRetry10s = process.env.RABBITMQ_RK_RETRY_10S; // webhook.retry.10s
    const rkRetry1m = process.env.RABBITMQ_RK_RETRY_1M;
    const rkRetry10m = process.env.RABBITMQ_RK_RETRY_10M;
    const rkDead = process.env.RABBITMQ_RK_DEAD; // webhook.dead

    const missing = [
      ['RABBITMQ_EXCHANGE', exchange],
      ['RABBITMQ_DLX_EXCHANGE', dlx],
      ['RABBITMQ_QUEUE_MAIN', qMain],
      ['RABBITMQ_QUEUE_RETRY_10S', qRetry10s],
      ['RABBITMQ_QUEUE_RETRY_1M', qRetry1m],
      ['RABBITMQ_QUEUE_RETRY_10M', qRetry10m],
      ['RABBITMQ_QUEUE_DEAD', qDead],
      ['RABBITMQ_RK_PROCESS', rkProcess],
      ['RABBITMQ_RK_RETRY_10S', rkRetry10s],
      ['RABBITMQ_RK_RETRY_1M', rkRetry1m],
      ['RABBITMQ_RK_RETRY_10M', rkRetry10m],
      ['RABBITMQ_RK_DEAD', rkDead],
    ].filter(([, v]) => !v);

    if (missing.length) {
      throw new Error(`Missing env vars: ${missing.map(([k]) => k).join(', ')}`);
    }

    // Exchanges
    await this.ch!.assertExchange(exchange!, 'topic', { durable: true });
    await this.ch!.assertExchange(dlx!, 'topic', { durable: true });

    // Main queue -> DLX -> retry.10s (primer escalón)
    await this.ch!.assertQueue(qMain!, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': dlx!,
        'x-dead-letter-routing-key': rkRetry10s!,
      },
    });
    await this.ch!.bindQueue(qMain!, exchange!, rkProcess!);

    // Retry queues (TTL) -> de vuelta al exchange principal con rkProcess
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

    // Dead queue
    await this.ch!.assertQueue(qDead!, { durable: true });
    await this.ch!.bindQueue(qDead!, dlx!, rkDead!);
  }

  async publish(routingKey: string, payload: unknown) {
    const exchange = process.env.RABBITMQ_EXCHANGE;
    if (!exchange) throw new Error('Missing env RABBITMQ_EXCHANGE');
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    const body = Buffer.from(JSON.stringify(payload));

    // confirm publish (callback) para saber si el broker lo aceptó
    await new Promise<void>((resolve, reject) => {
      this.ch!.publish(
        exchange,
        routingKey,
        body,
        { persistent: true, contentType: 'application/json' },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  async consume(queue: string, handler: (msg: ConsumeMessage) => Promise<void>) {
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    await this.ch.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        await handler(msg);
        this.ch!.ack(msg);
      } catch (err) {
        // Por defecto, mantiene tu comportamiento actual:
        // nack sin requeue => cae en DLX del queue actual
        this.logger.error(`Handler failed. nack->DLX. ${String(err)}`);
        this.ch!.nack(msg, false, false);
      }
    });
  }

    /**
   * Publica directamente al DLX exchange con una routing key específica (retry_1m, retry_10m, dead, etc)
   * y preserva headers/metadata importantes del mensaje original.
   */
  async publishToDLX(routingKey: string, msg: ConsumeMessage) {
    const dlx = process.env.RABBITMQ_DLX_EXCHANGE;
    if (!dlx) throw new Error('Missing env RABBITMQ_DLX_EXCHANGE');
    if (!this.ch) throw new Error('Rabbit channel is not initialized');

    // preserva headers + contentType, etc
    const props = {
      headers: msg.properties.headers ?? {},
      contentType: msg.properties.contentType ?? 'application/json',
      contentEncoding: msg.properties.contentEncoding,
      correlationId: msg.properties.correlationId,
      messageId: msg.properties.messageId,
      timestamp: msg.properties.timestamp,
      type: msg.properties.type,
      appId: msg.properties.appId,
      deliveryMode: 2, // persistent
    };

    await new Promise<void>((resolve, reject) => {
      this.ch!.publish(dlx, routingKey, msg.content, props, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Lee cantidad de muertes (reintentos) desde header x-death */
  getDeathCount(msg: ConsumeMessage): number {
    const headers = (msg.properties.headers ?? {}) as Record<string, any>;
    const xDeath = headers['x-death'];
    if (!Array.isArray(xDeath)) return 0;

    // suma counts si hay varios entries (por cola)
    return xDeath.reduce((acc: number, d: any) => acc + (typeof d?.count === 'number' ? d.count : 0), 0);
  }
}