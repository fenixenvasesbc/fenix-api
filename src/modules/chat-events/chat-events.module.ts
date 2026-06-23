import { Global, Module } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { ChatEventsService } from './chat-events.service';

@Global()
@Module({
  imports: [RabbitmqModule],
  providers: [ChatEventsService],
  exports: [ChatEventsService],
})
export class ChatEventsModule {}
