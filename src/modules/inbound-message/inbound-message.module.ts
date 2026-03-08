import { Module } from '@nestjs/common';
import { InboundMessageService } from './inbound-message.service';
import { InboundMessageWorker } from '../worker/inbound-message.worker';

@Module({
  providers: [InboundMessageService, InboundMessageWorker],
})
export class InboundMessageModule {}