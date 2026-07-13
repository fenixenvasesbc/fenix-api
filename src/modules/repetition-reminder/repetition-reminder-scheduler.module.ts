import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { RepetitionReminderModule } from './repetition-reminder.module';
import { RepetitionReminderSchedulerService } from './repetition-reminder-scheduler.service';

@Module({
  imports: [PrismaModule, RabbitmqModule, RepetitionReminderModule],
  providers: [RepetitionReminderSchedulerService],
})
export class RepetitionReminderSchedulerModule {}
