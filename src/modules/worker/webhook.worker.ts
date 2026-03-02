import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class WebhookWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookWorker.name);

  constructor(private readonly rabbit: RabbitmqService) {}

  async onModuleInit() {
    const qMain = process.env.RABBITMQ_QUEUE_MAIN!;
    this.logger.log(`Starting consumer on queue=${qMain}`);

    await this.rabbit.consume(qMain, async (msg) => {
      const payload = this.safeJson(msg);
      const id = payload?.id ?? msg.properties.messageId ?? '(no id)';
      this.logger.log(`Received message: ${id}`);

      try {
        // TODO: tu lógica real aquí (DB, idempotencia, routing a handlers, etc.)
        // Por ahora, solo validamos que sea JSON “útil”
        if (!payload) {
          throw new Error('Invalid JSON payload');
        }

        // si todo ok, simplemente retorna (RabbitmqService hará ack)
        return;
      } catch (err) {
        // decidir escalón de retry
        const deaths = this.rabbit.getDeathCount(msg);
        const { rk, action } = this.routeRetry(deaths);

        this.logger.error(
          `Handler failed for id=${id}. deaths=${deaths}. action=${action}. err=${String(err)}`,
        );

        if (rk) {
          // publicamos al DLX con routing key específica y ACK del original
          await this.rabbit.publishToDLX(rk, msg);
          // IMPORTANTE: para evitar doble-proceso, ACK del mensaje original
          // (ya lo re-enviamos al camino de retry/dead)
          // Nota: como tu consume hace ack/nack internamente, para esto necesitamos
          // que el RabbitmqService no auto-nack en el catch.
          // Por eso: ver ajuste #3 abajo.
        }

        // lanzamos el error para que el consume lo maneje según la política (ver ajuste #3)
        throw err;
      }
    });
  }

  private safeJson(msg: ConsumeMessage): any | null {
    try {
      return JSON.parse(msg.content.toString('utf8'));
    } catch {
      return null;
    }
  }

  /**
   * deaths = veces que Rabbit ya mandó este mensaje a dead-letter.
   * Política sugerida:
   * 0-2  => retry 10s
   * 3-5  => retry 1m
   * 6-8  => retry 10m
   * >=9  => dead
   */
  private routeRetry(deaths: number): { rk: string | null; action: string } {
    const rk10s = process.env.RABBITMQ_RK_RETRY_10S!;
    const rk1m = process.env.RABBITMQ_RK_RETRY_1M!;
    const rk10m = process.env.RABBITMQ_RK_RETRY_10M!;
    const rkDead = process.env.RABBITMQ_RK_DEAD!;

    if (deaths <= 2) return { rk: rk10s, action: 'retry_10s' };
    if (deaths <= 5) return { rk: rk1m, action: 'retry_1m' };
    if (deaths <= 8) return { rk: rk10m, action: 'retry_10m' };
    return { rk: rkDead, action: 'dead' };
  }
}