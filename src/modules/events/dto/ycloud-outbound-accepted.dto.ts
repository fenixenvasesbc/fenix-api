import { IsEmail, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

class YCloudTemplateLanguageDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class YCloudTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  language!: YCloudTemplateLanguageDto;

  @IsOptional()
  components?: unknown[];
}

export class YCloudOutboundAcceptedDto {
  // ---- Opcionales añadidos por tu sistema (sheet) ----
  @IsOptional()
  @IsString()
  leadName?: string;

  @IsOptional()
  @IsEmail()
  leadEmail?: string;

  // ---- Payload YCloud ----
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  wamid?: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsNotEmpty()
  from!: string;

  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  wabaId!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  template?: YCloudTemplateDto;

  @IsOptional()
  @IsISO8601()
  createTime?: string;

  @IsOptional()
  @IsISO8601()
  updateTime?: string;

  @IsOptional()
  @IsString()
  pricingCategory?: string;

  @IsOptional()
  @IsNumber()
  totalPrice?: number;
  
  @IsOptional()
  @IsString()
  currency?: string;
}