import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DesignRequestCountry } from '@prisma/client';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// IDs de familias/plantillas: formato UUID (8-4-4-4-12 hex) sin exigir version
// ni variante RFC 4122. Los IDs sembrados en migraciones se generan con
// md5(...)::uuid, que no cumple esos bits y @IsUUID() los rechazaria.
export const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_ID_MESSAGE = '$property must be a valid id';

export class CreateInvestmentFamilyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsEnum(DesignRequestCountry)
  country: DesignRequestCountry;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateInvestmentFamilyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(DesignRequestCountry)
  country?: DesignRequestCountry;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateAcquisitionTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  templateName: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID_PATTERN, { message: ENTITY_ID_MESSAGE })
  familyId?: string;
}

export class UpdateAcquisitionTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  templateName?: string;

  // null = dejar la plantilla sin familia (pendiente de asignar)
  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID_PATTERN, { message: ENTITY_ID_MESSAGE })
  familyId?: string | null;
}

export class SpendItemDto {
  @IsString()
  @Matches(ENTITY_ID_PATTERN, { message: ENTITY_ID_MESSAGE })
  familyId: string;

  // null = borrar la inversion cargada para esa familia y semana
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  amountCents?: number | null;
}

export class UpsertWeeklySpendDto {
  @Matches(DATE_KEY)
  weekStart: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SpendItemDto)
  items: SpendItemDto[];
}

export class WeeklySpendQueryDto {
  @Matches(DATE_KEY)
  weekStart: string;
}

export class AcquisitionReportQueryDto {
  @IsOptional()
  @Matches(DATE_KEY)
  from?: string;

  @IsOptional()
  @Matches(DATE_KEY)
  to?: string;

  @IsOptional()
  @IsIn(['family', 'country'])
  groupBy?: 'family' | 'country';
}
