import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateRatesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeWeekdayRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeSaturdayRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeSundayRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeHolidayRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  // Tope de duracion pagable por turno (minutos). Cubre el caso del reloj
  // dejado corriendo: por encima de este valor, el pago deja de contar
  // horas de mas y la entrada se marca para revision manual.
  @IsOptional()
  @IsBoolean()
  maxShiftEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60, { message: 'maxShiftMinutes debe ser de al menos 60 minutos' })
  maxShiftMinutes?: number;
}
