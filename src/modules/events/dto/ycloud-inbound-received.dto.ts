import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CustomerProfileDto {
  @IsOptional()
  @IsString()
  name?: string;
}

// Media para image/audio/video/document
class MediaDto {
  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  sha256?: string;

  @IsOptional()
  @IsString()
  mime_type?: string;

  @IsOptional()
  @IsBoolean()
  voice?: boolean;
}

class WhatsAppInboundMessageDto {
  @IsString()
  @IsNotEmpty()
  id!: string; // inbound message id (ycloud)

  @IsOptional()
  @IsString()
  wamid?: string;

  @IsString()
  @IsNotEmpty()
  wabaId!: string;

  @IsString()
  @IsNotEmpty()
  from!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerProfileDto)
  customerProfile?: CustomerProfileDto;

  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsOptional()
  @IsISO8601()
  sendTime?: string;

  @IsString()
  @IsNotEmpty()
  type!: string; // text|image|audio|video|document|...

  @IsOptional()
  @ValidateNested()
  @Type(() => TextDto)
  text?: TextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  image?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  audio?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  video?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  document?: MediaDto;

  /**
   * ✅ Context cambia mucho (forwarded, id, from, etc.)
   * Para que NO te rompa con forbidNonWhitelisted, lo aceptamos libre.
   */
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

export class YCloudInboundReceivedDto {
  @IsString()
  @IsNotEmpty()
  id!: string; // event id

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsOptional()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsISO8601()
  createTime?: string;

  @ValidateNested()
  @Type(() => WhatsAppInboundMessageDto)
  whatsappInboundMessage!: WhatsAppInboundMessageDto;
}