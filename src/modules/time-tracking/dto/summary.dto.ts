import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export type TimeTrackingSummaryGroupBy = 'day' | 'week' | 'month';

export class TimeTrackingSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: TimeTrackingSummaryGroupBy;
}
