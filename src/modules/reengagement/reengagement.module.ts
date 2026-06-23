import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReengagementDispatchService } from './reengagement-dispatch-service.service';
import { ReengagementSchedulerService } from './reengagement-scheduler-service.service';
import { CampaignTemplateResolverService } from './campaign-template-resolver-service.service';
import { ReengagementSelectionService } from './reengagement-selection-service.service';
import { YcloudModule } from '../ycloud/ycloud.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, YcloudModule, RabbitmqModule],
  providers: [
    ReengagementSelectionService,
    CampaignTemplateResolverService,
    ReengagementDispatchService,
    ReengagementSchedulerService,
    LeadLanguageResolverService,
  ],
  exports: [
    ReengagementDispatchService,
    ReengagementSelectionService,
    ReengagementSchedulerService,
    CampaignTemplateResolverService,
  ],
})
export class ReengagementModule {}
