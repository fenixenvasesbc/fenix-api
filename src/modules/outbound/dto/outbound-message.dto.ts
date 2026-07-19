import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class SendTemplateDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;

  @IsUUID()
  leadId: string;

  @IsUUID()
  clientRequestId: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  templateName: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(20)
  languageCode?: string | null;
}

export class SendTextDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;

  @IsUUID()
  leadId: string;

  @IsUUID()
  clientRequestId: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string;
}

export class SendMediaDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;

  @IsUUID()
  leadId: string;

  @IsUUID()
  clientRequestId: string;

  @IsIn(['image', 'audio', 'video', 'document'])
  type: 'image' | 'audio' | 'video' | 'document';

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mediaUrl: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(2048)
  providerMediaId?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsUUID()
  mediaUploadId?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(2048)
  mediaStorageKey?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mediaSizeBytes?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  mediaExpiresAt?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(1024)
  caption?: string | null;

  @ValidateIf((dto: SendMediaDto) => dto.type === 'document')
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName?: string | null;
}

export enum OutboundTemplateStatusFilter {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
  ALL = 'ALL',
}

export class ListOutboundTemplatesQueryDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsEnum(OutboundTemplateStatusFilter)
  status?: OutboundTemplateStatusFilter = OutboundTemplateStatusFilter.APPROVED;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  offset?: number = 0;
}
