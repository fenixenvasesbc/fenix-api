import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { SmbMessageEchoesService } from './smb-message-echoes.service';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';

@Module({
  imports: [ConversationModule],
  providers: [SmbMessageEchoesService, LeadLanguageResolverService],
  exports: [SmbMessageEchoesService],
})
export class SmbMessageEchoesModule {}
