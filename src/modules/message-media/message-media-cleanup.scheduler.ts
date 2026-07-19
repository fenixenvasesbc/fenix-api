import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MessageMediaService } from './message-media.service';

@Injectable()
export class MessageMediaCleanupScheduler {
  private readonly logger = new Logger(MessageMediaCleanupScheduler.name);

  constructor(private readonly messageMediaService: MessageMediaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    timeZone: process.env.MEDIA_CLEANUP_TIMEZONE ?? 'Europe/Madrid',
  })
  async runDailyCleanup() {
    if ((process.env.MEDIA_CLEANUP_ENABLED ?? 'true') !== 'true') return;

    const result = await this.messageMediaService.cleanupExpiredLocalMedia();
    if (result.inspected > 0) {
      this.logger.log(
        `Daily media cleanup result inspected=${result.inspected} deleted=${result.deleted} failed=${result.failed}`,
      );
    }
  }
}
