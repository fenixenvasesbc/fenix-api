import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

export class CreateLabelMessageRuleDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(60)
  labelCode: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  triggerAfterDays: number;

  @IsString()
  @MaxLength(255)
  templateName: string;
}

export class UpdateLabelMessageRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsString()
  @MaxLength(60)
  labelCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  triggerAfterDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  templateName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
