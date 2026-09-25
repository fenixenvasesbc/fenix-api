import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { DesignRequestSlaSchedulerService } from './design-request-sla-scheduler.service';

@Module({
  imports: [LeadsModule],
  providers: [DesignRequestSlaSchedulerService],
})
export class DesignRequestSlaSchedulerModule {}
