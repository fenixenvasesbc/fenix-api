import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebhookWorker } from './webhook.worker';
import { WebhookInboxModule } from '../webhook-inbox/webhook-inbox.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { InboundMessageModule } from '../inbound-message/inbound-message.module';
import { MessageStatusModule } from '../message-status/message-status.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RabbitmqModule,
    WebhookInboxModule,
    PrismaModule,
    InboundMessageModule,
    MessageStatusModule,
  ],
  providers: [WebhookWorker],
})
export class WorkerModule {}
