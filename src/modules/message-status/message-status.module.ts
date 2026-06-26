import { Module } from '@nestjs/common';

import { MessageStatusService } from './message-status.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [PrismaModule, ConversationModule],
  providers: [MessageStatusService],
  exports: [MessageStatusService],
})
export class MessageStatusModule {}
