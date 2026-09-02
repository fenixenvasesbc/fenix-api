import { Module } from '@nestjs/common';
import { TimeTrackingController } from './time-tracking.controller';
import { EmployeesService } from './employees.service';
import { TimeEntriesService } from './time-entries.service';
import { TimeTrackingRatesService } from './time-tracking-rates.service';
import { TimeTrackingSummaryService } from './time-tracking-summary.service';
import { TimeTrackingPurgeService } from './time-tracking-purge.service';
import { TimeTrackingHolidaysService } from './time-tracking-holidays.service';

@Module({
  controllers: [TimeTrackingController],
  providers: [
    EmployeesService,
    TimeEntriesService,
    TimeTrackingRatesService,
    TimeTrackingSummaryService,
    TimeTrackingPurgeService,
    TimeTrackingHolidaysService,
  ],
})
export class TimeTrackingModule {}
