import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EmployeeContractType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class CreateEmployeeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsEnum(EmployeeContractType)
  contractType: EmployeeContractType;

  // Precio por hora individual, opcional (09/nov/2026). Si se omite o se
  // manda null, el empleado usa la tarifa global TimeTrackingRate.hourlyRate
  // -- ver TimeEntriesService.computeFinancials(). Solo tiene efecto real
  // para contrato POR_HORAS. @ValidateIf antes de @IsOptional() -- mismo
  // patron que CreateLeadLabelDefinitionDto.alertThresholdDays -- para que
  // un null explicito no se transforme en 0 via @Type(() => Number).
  @ValidateIf((o) => o.hourlyRate !== null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyRate?: number | null;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(EmployeeContractType)
  contractType?: EmployeeContractType;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  // Precio por hora individual, opcional (09/nov/2026). Omitir el campo
  // deja el valor actual sin cambios; mandar null lo borra y el empleado
  // vuelve a tomar la tarifa global TimeTrackingRate.hourlyRate -- ver
  // TimeEntriesService.computeFinancials(). Solo tiene efecto real para
  // contrato POR_HORAS. @ValidateIf antes de @IsOptional() -- mismo patron
  // que UpdateLeadLabelDefinitionDto.alertThresholdDays -- para que un
  // null explicito no se transforme en 0 via @Type(() => Number).
  @ValidateIf((o) => o.hourlyRate !== null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyRate?: number | null;
}

export class ListEmployeesQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class EmployeeIdParamDto {
  @IsUUID()
  id: string;
}
