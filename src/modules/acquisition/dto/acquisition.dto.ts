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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DesignRequestCountry } from '@prisma/client';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

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

export class CreateLandingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  slug: string;

  @IsOptional()
  @IsUUID()
  familyId?: string;
}

export class UpdateLandingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  slug?: string;

  // null = dejar la landing sin familia (pendiente de asignar)
  @IsOptional()
  @IsUUID()
  familyId?: string | null;
}

export class SpendItemDto {
  @IsUUID()
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
