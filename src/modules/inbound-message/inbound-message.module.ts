import { Module } from '@nestjs/common';
import { InboundMessageService } from './inbound-message.service';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { ConversationModule } from '../conversation/conversation.module';
import { MessageMediaModule } from '../message-media/message-media.module';

@Module({
  imports: [ConversationModule, MessageMediaModule],
  providers: [InboundMessageService, LeadLanguageResolverService],
  exports: [InboundMessageService],
})
export class InboundMessageModule {}
