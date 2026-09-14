import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { LabelMessageRuleModule } from './label-message-rule.module';
import { LabelMessageRuleSchedulerService } from './label-message-rule-scheduler.service';

@Module({
  imports: [PrismaModule, RabbitmqModule, LabelMessageRuleModule],
  providers: [LabelMessageRuleSchedulerService],
})
export class LabelMessageRuleSchedulerModule {}
