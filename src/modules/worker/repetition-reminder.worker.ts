import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { RepetitionReminderJobPayload } from 'src/common/types/RepetitionReminderJobPayload';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { RepetitionReminderDispatchService } from '../repetition-reminder/repetition-reminder-dispatch.service';
import { YcloudRequestError } from '../ycloud/ycloud.service';

@Injectable()
export class RepetitionReminderWorker implements OnModuleInit {
  private readonly logger = new Logger(RepetitionReminderWorker.name);

  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly dispatchService: RepetitionReminderDispatchService,
  ) {}

  async onModuleInit() {
    const queue = process.env.RABBITMQ_QUEUE_REPETITION_REMINDER;
    const rkRetry10s =
      process.env.RABBITMQ_RK_REPETITION_REMINDER_RETRY_10S;
    const rkRetry1m = process.env.RABBITMQ_RK_REPETITION_REMINDER_RETRY_1M;
    const rkRetry10m =
      process.env.RABBITMQ_RK_REPETITION_REMINDER_RETRY_10M;
    const rkDead = process.env.RABBITMQ_RK_DEAD;

    if (!queue) {
      throw new Error('Missing env RABBITMQ_QUEUE_REPETITION_REMINDER');
    }
    if (!rkRetry10s) {
      throw new Error(
        'Missing env RABBITMQ_RK_REPETITION_REMINDER_RETRY_10S',
      );
    }
    if (!rkRetry1m) {
      throw new Error(
        'Missing env RABBITMQ_RK_REPETITION_REMINDER_RETRY_1M',
      );
    }
    if (!rkRetry10m) {
      throw new Error(
        'Missing env RABBITMQ_RK_REPETITION_REMINDER_RETRY_10M',
      );
    }
    if (!rkDead) throw new Error('Missing env RABBITMQ_RK_DEAD');

    await this.rabbitmqService.consume(queue, async (msg: ConsumeMessage) => {
      let leadCampaignId: string | undefined;

      try {
        const payload = JSON.parse(
          msg.content.toString(),
        ) as RepetitionReminderJobPayload;

        leadCampaignId = payload.leadCampaignId;

        this.logger.log(
          `Received repetition reminder job leadCampaignId=${leadCampaignId}`,
        );

        await this.dispatchService.dispatch(leadCampaignId);

        return { action: 'ack' as const };
      } catch (error: any) {
        const deaths = this.rabbitmqService.getDeathCount(msg);

        if (error instanceof YcloudRequestError && !error.retryable) {
          if (leadCampaignId) {
            await this.dispatchService.markFailed(
              leadCampaignId,
              error.providerMessage ?? error.message,
            );
          }

          this.logger.error(
            `Repetition reminder failed permanently leadCampaignId=${leadCampaignId ?? 'unknown'} status=${error.statusCode ?? 'n/a'} message=${error.providerMessage ?? error.message}`,
          );

          return { action: 'ack' as const };
        }

        this.logger.error(
          `Repetition reminder worker failed deaths=${deaths} leadCampaignId=${leadCampaignId ?? 'unknown'} error=${String(error)}`,
        );

        if (deaths >= 3) {
          if (leadCampaignId) {
            const message =
              error instanceof YcloudRequestError
                ? (error.providerMessage ?? error.message)
                : error instanceof Error
                  ? error.message
                  : 'Unknown retryable worker error';

            await this.dispatchService.markFailed(leadCampaignId, message);
          }

          return { action: 'dead' as const, routingKey: rkDead };
        }

        if (deaths === 0) {
          return { action: 'retry' as const, routingKey: rkRetry10s };
        }

        if (deaths === 1) {
          return { action: 'retry' as const, routingKey: rkRetry1m };
        }

        return { action: 'retry' as const, routingKey: rkRetry10m };
      }
    });

    this.logger.log(`Repetition reminder worker consuming queue=${queue}`);
  }
}
