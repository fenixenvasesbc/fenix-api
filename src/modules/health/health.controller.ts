import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { errorMessage } from 'src/common/utils/logging';

/**
 * GET /health — estado de la API para monitorizacion externa (UptimeRobot,
 * healthcheck de Docker, etc.). Devuelve 200 si BD y RabbitMQ responden y
 * 503 si alguno falla. Es publico (no hay guard global) y no expone datos.
 *
 * Nota: refleja la conexion RabbitMQ del proceso API. El proceso worker no
 * expone HTTP; su estado se ve en los logs (reconexiones, [cron:*] y errores
 * de consumidores).
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitmqService,
  ) {}

  @Get()
  async check(@Res() res: Response) {
    const startedAt = Date.now();
    let database: { ok: boolean; latencyMs?: number; error?: string };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      database = { ok: false, error: errorMessage(error) };
    }

    const rabbitStatus = this.rabbit.getStatus();
    const ok = database.ok && rabbitStatus.connected;

    if (!ok) {
      this.logger.warn(
        `Health check failed database=${database.ok} rabbitmq=${rabbitStatus.connected}`,
      );
    }

    return res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: ok ? 'ok' : 'degraded',
      uptimeSec: Math.round(process.uptime()),
      checks: {
        database,
        rabbitmq: rabbitStatus,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
