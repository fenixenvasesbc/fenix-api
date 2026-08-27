import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AssistantFeedbackRating, AssistantKnowledgeImportStatus } from '@prisma/client';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class AssistantQueryDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  sessionId?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;
}

export class AssistantSessionsQueryDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AssistantFeedbackDto {
  @IsEnum(AssistantFeedbackRating)
  rating: AssistantFeedbackRating;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(4000)
  editedText?: string;
}

export class AssistantKnowledgeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(120)
  datasetId?: string;
}

export class AssistantKnowledgeUploadDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  datasetId: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(180)
  documentName?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(120)
  replaceDocumentId?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(240)
  replaceDocumentName?: string;
}

export class AssistantKnowledgeDocumentStatusDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  datasetId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  enabled: boolean;
}

export class AssistantKnowledgeDatasetsQueryDto {
  // Cuantos documentos de Dify traer por cada base de conocimiento (para saber
  // que hay ya subido en cada dataset antes de elegir donde subir uno nuevo).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  documentsLimit?: number;
}

export class AssistantKnowledgeImportsQueryDto {
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsEnum(AssistantKnowledgeImportStatus)
  status?: AssistantKnowledgeImportStatus;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(120)
  datasetId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
