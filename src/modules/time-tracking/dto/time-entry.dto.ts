import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ClockDto {
  @IsUUID()
  employeeId: string;
}

export class ListEntriesQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
