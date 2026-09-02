import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { HolidayScope } from '@prisma/client';

export class CreateHolidayDto {
  // Formato YYYY-MM-DD (fecha civil, sin hora).
  @IsDateString()
  date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsEnum(HolidayScope)
  scope?: HolidayScope;

  // Solo tiene sentido cuando scope = REGIONAL o LOCAL (p.ej. "Comunidad de Madrid").
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;
}

export class BulkCreateHolidaysDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHolidayDto)
  holidays: CreateHolidayDto[];
}

export class ListHolidaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class HolidayIdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
