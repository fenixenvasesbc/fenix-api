import { Module } from '@nestjs/common';
import { YcloudModule } from '../ycloud/ycloud.module';
import { CampaignTemplatesController } from './campaign-templates.controller';
import { CampaignTemplateSyncService } from './campaign-template-sync.service';

@Module({
  imports: [YcloudModule],
  controllers: [CampaignTemplatesController],
  providers: [CampaignTemplateSyncService],
  exports: [CampaignTemplateSyncService],
})
export class CampaignTemplatesModule {}
