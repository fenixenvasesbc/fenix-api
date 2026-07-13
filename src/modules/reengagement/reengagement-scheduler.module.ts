import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { ReengagementModule } from './reengagement.module';
import { ReengagementSchedulerService } from './reengagement-scheduler-service.service';

@Module({
  imports: [PrismaModule, RabbitmqModule, ReengagementModule],
  providers: [ReengagementSchedulerService],
})
export class ReengagementSchedulerModule {}
