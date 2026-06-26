import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ClicheCategory } from '@prisma/client';

const normalizeUppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateClicheDto {
  @Transform(normalizeUppercase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsEnum(ClicheCategory)
  category: ClicheCategory;

  @Transform(normalizeUppercase)
  @IsString()
  @Matches(/^[A-Z]+[0-9]+$/, {
    message: 'letter must use a physical location format such as D1 or F3',
  })
  @MaxLength(20)
  letter: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(9999)
  year: number;
}

export class UpdateClicheDto {
  @IsOptional()
  @Transform(normalizeUppercase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(ClicheCategory)
  category?: ClicheCategory;

  @IsOptional()
  @Transform(normalizeUppercase)
  @IsString()
  @Matches(/^[A-Z]+[0-9]+$/, {
    message: 'letter must use a physical location format such as D1 or F3',
  })
  @MaxLength(20)
  letter?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(9999)
  year?: number;
}

export class ListClichesQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  )
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsEnum(ClicheCategory)
  category?: ClicheCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(9999)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}

export class ClicheIdParamDto {
  @IsUUID()
  id: string;
}
