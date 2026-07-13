import { Module } from '@nestjs/common';
import { LeadLanguageResolverService } from 'src/common/utils/lead-language-resolver.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ChatEventsModule } from '../chat-events/chat-events.module';
import { ConversationModule } from '../conversation/conversation.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { CampaignTemplateResolverService } from '../reengagement/campaign-template-resolver-service.service';
import { YcloudModule } from '../ycloud/ycloud.module';
import { RepetitionReminderDispatchService } from './repetition-reminder-dispatch.service';

@Module({
  imports: [
    PrismaModule,
    RabbitmqModule,
    YcloudModule,
    ConversationModule,
    ChatEventsModule,
  ],
  providers: [
    CampaignTemplateResolverService,
    LeadLanguageResolverService,
    RepetitionReminderDispatchService,
  ],
  exports: [RepetitionReminderDispatchService],
})
export class RepetitionReminderModule {}
