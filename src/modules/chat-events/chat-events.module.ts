import { Global, Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { ChatEventsService } from './chat-events.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [RabbitmqModule, PrismaModule],
  providers: [ChatEventsService],
  exports: [ChatEventsService],
})
export class ChatEventsModule {}
