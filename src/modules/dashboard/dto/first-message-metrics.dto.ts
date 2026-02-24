import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FirstMessageMetricsDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsIn(['week', 'month'])
  groupBy!: 'week' | 'month';

  // ADMIN puede pasar accountId; SALES se fuerza al suyo
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responseWindowHours: number = 168; // 7 días por defecto

  @IsOptional()
  @Type(() => Boolean)
  groupByAccount?: boolean = false;
}