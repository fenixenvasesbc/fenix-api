import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { YcloudModule } from '../ycloud/ycloud.module';
import { MediaUploadController } from './media-upload.controller';
import { MediaUploadService } from './media-upload.service';

@Module({
  imports: [PrismaModule, YcloudModule],
  controllers: [MediaUploadController],
  providers: [MediaUploadService],
})
export class MediaUploadModule {}
