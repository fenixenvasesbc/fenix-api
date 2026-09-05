import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}

export class CreateLeadLabelDefinitionDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsHexColor()
  color?: string;

  // Dias que un lead puede estar en esta label antes de generar una
  // AppNotification (alerta in-app). null/omitido = sin alerta configurada.
  // No tiene relacion con el envio automatico de mensajes de WhatsApp.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  alertThresholdDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateLeadLabelDefinitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsHexColor()
  color?: string;

  // Puede llegar explicitamente en null para borrar el umbral configurado
  // (desactivar la alerta de esta label) sin tener que borrar la label.
  @ValidateIf((o) => o.alertThresholdDays !== null)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  alertThresholdDays?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
