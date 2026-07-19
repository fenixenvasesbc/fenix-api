import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ChatEventsModule } from '../chat-events/chat-events.module';
import { SmbHistoryService } from './smb-history.service';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { MessageMediaModule } from '../message-media/message-media.module';

@Module({
  imports: [PrismaModule, ChatEventsModule, MessageMediaModule],
  providers: [SmbHistoryService, LeadLanguageResolverService],
  exports: [SmbHistoryService],
})
export class SmbHistoryModule {}
