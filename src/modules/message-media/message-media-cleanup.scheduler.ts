import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MessageMediaService } from './message-media.service';
import { runCronWithSummary } from 'src/common/utils/logging';

@Injectable()
export class MessageMediaCleanupScheduler {
  private readonly logger = new Logger(MessageMediaCleanupScheduler.name);

  constructor(private readonly messageMediaService: MessageMediaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    timeZone: process.env.MEDIA_CLEANUP_TIMEZONE ?? 'Europe/Madrid',
  })
  async runDailyCleanup() {
    if ((process.env.MEDIA_CLEANUP_ENABLED ?? 'true') !== 'true') {
      this.logger.log('Daily media cleanup disabled (MEDIA_CLEANUP_ENABLED)');
      return;
    }

    // runCronWithSummary deja siempre inicio + resumen (aunque no haya nada
    // que borrar) y sube a warn si hubo fallos al borrar.
    await runCronWithSummary(this.logger, 'media-cleanup', async (stats) => {
      const result = await this.messageMediaService.cleanupExpiredLocalMedia();
      stats.inspected = result.inspected;
      stats.deleted = result.deleted;
      stats.failed = result.failed;
    });
  }
}
