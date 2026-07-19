import { Module } from '@nestjs/common';

import { MessageStatusService } from './message-status.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConversationModule } from '../conversation/conversation.module';
import { MessageMediaModule } from '../message-media/message-media.module';

@Module({
  imports: [PrismaModule, ConversationModule, MessageMediaModule],
  providers: [MessageStatusService],
  exports: [MessageStatusService],
})
export class MessageStatusModule {}
