import { IsDateString } from 'class-validator';

export class SpendMetricsDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
