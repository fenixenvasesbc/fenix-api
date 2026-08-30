import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export enum GlobalTemplateCategoryDto {
  AUTHENTICATION = 'AUTHENTICATION',
  MARKETING = 'MARKETING',
  UTILITY = 'UTILITY',
}

export class GlobalTemplateButtonDto {
  @IsIn(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'])
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  text: string;

  @ValidateIf((dto: GlobalTemplateButtonDto) => dto.type === 'URL')
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url?: string;

  @ValidateIf((dto: GlobalTemplateButtonDto) => dto.type === 'PHONE_NUMBER')
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber?: string;
}

export class CreateGlobalTemplateDto {
  // Meta exige minusculas, numeros y guion bajo.
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^[a-z0-9_]{1,512}$/, {
    message: 'name solo puede tener minusculas, numeros y guion bajo (_)',
  })
  name: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(20)
  language: string;

  @IsEnum(GlobalTemplateCategoryDto)
  category: GlobalTemplateCategoryDto;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(60)
  headerText?: string;

  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO', 'DOCUMENT'])
  headerFormat?: 'IMAGE' | 'VIDEO' | 'DOCUMENT';

  @ValidateIf((dto: CreateGlobalTemplateDto) => !!dto.headerFormat)
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  headerMediaUrl?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  bodyText: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  bodyExamples?: string[];

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(trimString(value)))
  @IsString()
  @MaxLength(60)
  footerText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GlobalTemplateButtonDto)
  buttons?: GlobalTemplateButtonDto[];
}

export class AddGlobalTemplateAccountDto {
  @IsUUID()
  accountId: string;
}
