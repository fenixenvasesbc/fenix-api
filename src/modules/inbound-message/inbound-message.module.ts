import { Module } from '@nestjs/common';
import { InboundMessageService } from './inbound-message.service';
import { InboundMessageWorker } from '../worker/inbound-message.worker';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';

@Module({
  providers: [
    InboundMessageService,
    InboundMessageWorker,
    LeadLanguageResolverService,
  ],
})
export class InboundMessageModule {}
