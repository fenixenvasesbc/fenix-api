import { IsDateString, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class DateRangeDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class FirstMessageMetricsDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  groupByAccount?: boolean = false;
}

export class AccountFirstMessageMetricsDto extends DateRangeDto {
  @IsUUID()
  accountId!: string;
}
