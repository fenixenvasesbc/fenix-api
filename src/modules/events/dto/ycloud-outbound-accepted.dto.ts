import { IsEmail, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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

  // ADR-007 (version inicial, sin uso): slug de la landing. La atribucion pasa
  // por la plantilla del envio; se sigue aceptando para no responder 400 si
  // algun flujo de n8n llegara a mandarlo (forbidNonWhitelisted).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  producto?: string;

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