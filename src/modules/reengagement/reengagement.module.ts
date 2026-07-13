import { Module } from '@nestjs/common';
import { ReengagementDispatchService } from './reengagement-dispatch-service.service';
import { CampaignTemplateResolverService } from './campaign-template-resolver-service.service';
import { ReengagementSelectionService } from './reengagement-selection-service.service';
import { YcloudModule } from '../ycloud/ycloud.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [PrismaModule, YcloudModule, RabbitmqModule],
  providers: [
    ReengagementSelectionService,
    CampaignTemplateResolverService,
    ReengagementDispatchService,
    LeadLanguageResolverService,
  ],
  exports: [
    ReengagementDispatchService,
    ReengagementSelectionService,
    CampaignTemplateResolverService,
  ],
})
export class ReengagementModule {}
