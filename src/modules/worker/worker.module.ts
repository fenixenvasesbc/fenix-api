import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebhookWorker } from './webhook.worker';
import { WebhookInboxModule } from '../webhook-inbox/webhook-inbox.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';


@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),RabbitmqModule, WebhookInboxModule, PrismaModule],
  providers: [WebhookWorker],
})
export class WorkerModule {}