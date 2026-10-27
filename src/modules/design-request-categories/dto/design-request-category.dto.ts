import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

export class CreateDesignRequestCategoryDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsHexColor()
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateDesignRequestCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
