import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebhookWorker } from './webhook.worker';


@Module({
  imports: [RabbitmqModule],
  providers: [WebhookWorker],
})
export class WorkerModule {}