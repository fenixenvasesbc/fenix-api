import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DesignAttachmentKind, DesignRequestCountry } from '@prisma/client';

export class CreateDesignRequestAttachmentDto {
  @IsEnum(DesignAttachmentKind)
  kind!: DesignAttachmentKind;

  // Requerido si kind = FROM_CHAT: referencia a un Message ya existente,
  // sin copiar/descargar nada de nuevo.
  @IsOptional()
  @IsUUID()
  sourceMessageId?: string;

  // Usados si kind = UPLOADED: metadata de un archivo ya subido por otro
  // endpoint (el MVP no reimplementa un pipeline de subida propio).
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  mediaStorageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sizeBytes?: number;
}

// Tipo de solicitud elegido explicitamente por SALES/ADMIN en el modal de
// creacion (reemplaza la deteccion por regex en el titulo -- acordado con
// el cliente, 06/oct/2026). Determina el plazo (ver
// DesignBoardService.resolveCreationSlaBusinessDays):
//   - BOCETO: 3 dias habiles (default del tablero), salvo que la
//     descripcion mencione un producto de plazo extendido (4 dias).
//   - MOD: 1 dia habil (mismo plazo que REPET_MOD/REPET_ANADE).
//   - REPET_BOCETO: 2 dias habiles.
//   - REPET_MOD / REPET_ANADE: 1 dia habil.
// El titulo sigue siendo texto libre, ya no se interpreta para esto.
export type DesignRequestType =
  | 'BOCETO'
  | 'MOD'
  | 'REPET_BOCETO'
  | 'REPET_MOD'
  | 'REPET_ANADE';

export const DESIGN_REQUEST_TYPES: DesignRequestType[] = [
  'BOCETO',
  'MOD',
  'REPET_BOCETO',
  'REPET_MOD',
  'REPET_ANADE',
];

export class CreateDesignRequestDto {
  @IsUUID()
  leadId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsIn(DESIGN_REQUEST_TYPES)
  requestType?: DesignRequestType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsEnum(DesignRequestCountry)
  country?: DesignRequestCountry;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateDesignRequestAttachmentDto)
  attachments?: CreateDesignRequestAttachmentDto[];
}

export class ListDesignRequestsQueryDto {
  @IsOptional()
  @IsUUID()
  columnId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  // ADR-004 Submódulo 9: filtro por mes para la columna "Terminado"
  // (isFinal). "YYYY-MM" para un mes puntual, o "all" para ver el
  // histórico completo. Solo tiene efecto cuando `columnId` apunta a esa
  // columna; si se omite, esa columna filtra al mes actual por defecto.
  @IsOptional()
  @Matches(/^(\d{4}-(0[1-9]|1[0-2])|all)$/)
  completedMonth?: string;

  // ADR-004 Submódulo 8: por defecto el tablero excluye las tarjetas
  // archivadas desde "Aprobados"; true las vuelve a incluir (uso interno /
  // reportes, no la vista de tablero normal).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  // Pedido explicito del usuario, 23/oct/2026: buscar solicitudes por
  // titulo (contains, insensible a mayusculas -- ver listRequests() en
  // DesignBoardService).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  // Pedido explicito del usuario, 23/oct/2026: filtro general del tablero
  // por mes (TODAS las columnas, segun createdAt) -- "YYYY-MM" para un
  // mes puntual, 'all' para ver el historico completo. Si se omite,
  // listRequests() usa el mes actual por defecto (ver monthRange()).
  @IsOptional()
  @Matches(/^(\d{4}-(0[1-9]|1[0-2])|all)$/)
  month?: string;
}

export class DesignBoardReportsQueryDto {
  // ADR-004 Submódulo 10: "YYYY-MM" para un mes puntual; si se omite, el
  // mes actual (mismo formato/convención que ListDesignRequestsQueryDto).
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

// Edicion de titulo/descripcion por la comercial propietaria (o ADMIN)
// despues de creada la solicitud -- pedido explicito del cliente. A
// proposito NO permite tocar requestType/country/attachments (eso se
// gestiona con sus propios flujos ya existentes) y nunca recalcula
// slaBusinessDays/dueAt: el plazo se fija una sola vez al crear
// (resolveCreationSlaBusinessDays) y no se re-evalua al editar la
// descripcion despues, para no mover un plazo que el diseñador ya esta
// viendo correr. Al menos un campo es obligatorio (ver
// DesignBoardService.updateRequest).
// Pedido explicito del usuario (23/oct/2026): la comercial propietaria (o
// ADMIN) puede editar los mismos campos que elige al crear la solicitud --
// titulo, descripcion, pais y tipo -- no solo titulo/instructions como
// antes. Editar requestType puede recalcular el plazo (ver
// DesignBoardService.updateRequest): solo si el tipo efectivo realmente
// cambia respecto al que ya tenia.
export class UpdateDesignRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsEnum(DesignRequestCountry)
  country?: DesignRequestCountry;

  @IsOptional()
  @IsIn(DESIGN_REQUEST_TYPES)
  requestType?: DesignRequestType;
}

export class AssignDesignRequestDto {
  @IsUUID()
  assignedUserId!: string;
}

export class MoveDesignRequestDto {
  @IsIn(['FORWARD', 'BACKWARD'])
  direction!: 'FORWARD' | 'BACKWARD';
}

export class AddDesignRequestCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  // ADR-004 Submódulo 3: adjuntos dentro de un comentario, mismo shape que
  // los adjuntos de la solicitud (reusa CreateDesignRequestAttachmentDto).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateDesignRequestAttachmentDto)
  attachments?: CreateDesignRequestAttachmentDto[];
}

export class EditDesignRequestCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}
