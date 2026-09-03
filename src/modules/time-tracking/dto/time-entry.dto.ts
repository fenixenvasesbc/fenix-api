import { IsDateString, IsISO8601, IsOptional, IsUUID } from 'class-validator';

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

export class TimeEntryIdParamDto {
  @IsUUID()
  id: string;
}

// Edicion manual de un fichaje ya cerrado (ADMIN / FACTORY_MANAGER). Ambas
// fechas son obligatorias: no se permite crear fichajes nuevos por aqui, solo
// corregir hora de entrada/salida de uno existente.
export class UpdateTimeEntryDto {
  @IsISO8601()
  clockInAt: string;

  @IsISO8601()
  clockOutAt: string;
}
