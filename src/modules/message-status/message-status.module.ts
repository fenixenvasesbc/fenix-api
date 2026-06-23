import { Module } from '@nestjs/common';

import { MessageStatusService } from './message-status.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [MessageStatusService],
  exports: [MessageStatusService],
})
export class MessageStatusModule {}
