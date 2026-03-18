import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { ReengagementDispatchService } from '../reengagement/reengagement-dispatch-service.service';

@Injectable()
export class ReengagementWorker implements OnModuleInit {
  private readonly logger = new Logger(ReengagementWorker.name);

  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly dispatchService: ReengagementDispatchService,
  ) {}

  async onModuleInit() {
    const queue = process.env.RABBITMQ_QUEUE_REENGAGEMENT;
    const rkRetry10s = process.env.RABBITMQ_RK_RETRY_10S;
    const rkDead = process.env.RABBITMQ_RK_DEAD;

    if (!queue) throw new Error('Missing env RABBITMQ_QUEUE_REENGAGEMENT');
    if (!rkRetry10s) throw new Error('Missing env RABBITMQ_RK_RETRY_10S');
    if (!rkDead) throw new Error('Missing env RABBITMQ_RK_DEAD');

    await this.rabbitmqService.consume(queue, async (msg: ConsumeMessage) => {
      try {
        const payload = JSON.parse(msg.content.toString()) as {
          leadCampaignId: string;
        };

        this.logger.log(
          `Received reengagement job leadCampaignId=${payload.leadCampaignId}`,
        );

        await this.dispatchService.dispatch(payload.leadCampaignId);

        return { action: 'ack' };
      } catch (error) {
        const deaths = this.rabbitmqService.getDeathCount(msg);

        this.logger.error(
          `Reengagement worker failed deaths=${deaths} error=${String(error)}`,
        );

        if (deaths >= 3) {
          return { action: 'dead', routingKey: rkDead };
        }

        return { action: 'retry', routingKey: rkRetry10s };
      }
    });

    this.logger.log(`Reengagement worker consuming queue=${queue}`);
  }
}
