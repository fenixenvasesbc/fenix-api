import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReengagementDispatchService } from './reengagement-dispatch-service.service';
import { ReengagementWorker } from '../worker/ReengagementWorker';
import { ReengagementSchedulerService } from './reengagement-scheduler-service.service';
import { CampaignTemplateResolverService } from './campaign-template-resolver-service.service';
import { ReengagementSelectionService } from './reengagement-selection-service.service';
import { YcloudModule } from '../ycloud/ycloud.module';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, YcloudModule],
  providers: [
    ReengagementSelectionService,
    CampaignTemplateResolverService,
    ReengagementDispatchService,
    ReengagementSchedulerService,
    ReengagementWorker,
  ],
  exports: [
    ReengagementDispatchService,
    ReengagementSelectionService,
    ReengagementSchedulerService,
    CampaignTemplateResolverService,
  ],
})
export class ReengagementModule {}
