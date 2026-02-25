import {
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

class ContextDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  id?: string;
}

class TextDto {
  @IsString()
  @IsNotEmpty()
  body!: string;
}

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
}

class WhatsAppInboundMessageDto {
  @IsString()
  @IsNotEmpty()
  id!: string; // inboundMessageId (ycloud)

  @IsOptional()
  @IsString()
  wamid?: string;

  @IsString()
  @IsNotEmpty()
  wabaId!: string;

  @IsString()
  @IsNotEmpty()
  from!: string; // customer phone

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerProfileDto)
  customerProfile?: CustomerProfileDto;

  @IsString()
  @IsNotEmpty()
  to!: string; // business phone

  @IsOptional()
  @IsISO8601()
  sendTime?: string;

  @IsString()
  @IsNotEmpty()
  type!: string; // text|image|document|video|audio...

  @IsOptional()
  @ValidateNested()
  @Type(() => TextDto)
  text?: TextDto;

  // media types (solo uno suele venir según type)
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  image?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  video?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  audio?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  document?: MediaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextDto)
  context?: ContextDto;
}

export class YCloudInboundReceivedDto {
  @IsString()
  @IsNotEmpty()
  id!: string; // event id

  @IsString()
  @IsNotEmpty()
  type!: string; // whatsapp.inbound_message.received

  @IsOptional()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsISO8601()
  createTime?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => WhatsAppInboundMessageDto)
  whatsappInboundMessage!: WhatsAppInboundMessageDto;
}