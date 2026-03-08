import { Module } from '@nestjs/common';

import { MessageStatusService } from './message-status.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { MessageStatusWorker } from '../worker/message-status.worker';

@Module({
  imports: [RabbitmqModule, PrismaModule],
  providers: [MessageStatusWorker, MessageStatusService],
})
export class MessageStatusModule {}
