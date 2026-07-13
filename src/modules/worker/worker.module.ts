import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebhookWorker } from './webhook.worker';
import { WebhookInboxModule } from '../webhook-inbox/webhook-inbox.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { InboundMessageModule } from '../inbound-message/inbound-message.module';
import { MessageStatusModule } from '../message-status/message-status.module';
import { InboundMessageWorker } from './inbound-message.worker';
import { MessageStatusWorker } from './message-status.worker';
import { ReengagementModule } from '../reengagement/reengagement.module';
import { ReengagementWorker } from './ReengagementWorker';
import { ChatEventsModule } from '../chat-events/chat-events.module';
import { ContactAttributesModule } from '../contact-attributes/contact-attributes.module';
import { ContactAttributesWorker } from './contact-attributes.worker';
import { SmbStateSyncModule } from '../smb-state-sync/smb-state-sync.module';
import { SmbStateSyncWorker } from './smb-state-sync.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RabbitmqModule,
    WebhookInboxModule,
    PrismaModule,
    InboundMessageModule,
    MessageStatusModule,
    ReengagementModule,
    ChatEventsModule,
    ContactAttributesModule,
    SmbStateSyncModule,
  ],
  providers: [
    WebhookWorker,
    InboundMessageWorker,
    MessageStatusWorker,
    ReengagementWorker,
    ContactAttributesWorker,
    SmbStateSyncWorker,
  ],
})
export class WorkerModule {}
