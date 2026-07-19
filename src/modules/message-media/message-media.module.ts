import { Module } from '@nestjs/common';
import { MessageMediaController } from './message-media.controller';
import { MessageMediaCleanupScheduler } from './message-media-cleanup.scheduler';
import { MessageMediaService } from './message-media.service';

@Module({
  controllers: [MessageMediaController],
  providers: [MessageMediaService, MessageMediaCleanupScheduler],
  exports: [MessageMediaService],
})
export class MessageMediaModule {}
