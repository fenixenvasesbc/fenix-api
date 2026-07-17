import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsSchedulerService {
  private readonly logger = new Logger(NotificationsSchedulerService.name);
  private running = false;

  constructor(private readonly notificationsService: NotificationsService) {}

  @Cron('0 7 * * *', { timeZone: 'Europe/Madrid' })
  async runDailyLabelAlerts() {
    if (process.env.NOTIFICATION_LABEL_ALERT_SCHEDULER_ENABLED === 'false') {
      this.logger.log('Label alert notification scheduler disabled');
      return;
    }

    if (this.running) {
      this.logger.warn('Label alert notification scheduler already running');
      return;
    }

    this.running = true;

    try {
      const result = await this.notificationsService.runLabelAlerts();
      this.logger.log(
        `Label alert notification scheduler finished inspected=${result.inspected} created=${result.created}`,
      );
    } catch (error) {
      this.logger.error(
        `Label alert notification scheduler failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
