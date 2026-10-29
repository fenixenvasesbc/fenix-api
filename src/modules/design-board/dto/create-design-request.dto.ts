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

  // Pedido explicito del usuario, 27/oct/2026: una o varias categorias
  // (DesignRequestCategory, catalogo aparte de las labels de lead) --
  // ver DesignRequestCategoriesService.assertActiveCategoryIds().
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  categoryIds?: string[];
}

export class ListDesignRequestsQueryDto {
  @IsOptional()
  @IsUUID()
  columnId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  // Pedido explicito del usuario, 27/oct/2026: filtro del tablero para
  // ver solo las solicitudes SIN diseñador asignado (assignedUserId es
  // null) -- uso tipico del Jefe de Diseño/ADMIN para repartir trabajo
  // pendiente. Si se manda junto con assignedUserId, visibilityWhere()
  // prioriza este filtro (no tendria sentido pedir los dos a la vez).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassignedOnly?: boolean;

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

// Pedido explicito del usuario, 28/oct/2026: al aprobar desde el
// tablero, la comercial puede indicar de una vez cuales de los adjuntos
// (tarjeta o comentarios) son la version que el cliente aprobo -- ver
// DesignBoardService.approve(). Opcional: una aprobacion automatica por
// etiqueta (approveByLabel) nunca manda esto, y tambien se puede marcar
// despues desde el detalle (markApprovedVersionAttachment()).
export class ApproveDesignRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  approvedAttachmentIds?: string[];
}

// Pedido explicito del usuario, 28/oct/2026: marcar/desmarcar un adjunto
// concreto como "version aprobada" fuera del momento de aprobar (p.ej. la
// comercial se da cuenta despues de que marco el archivo equivocado, o la
// solicitud se aprobo automaticamente por etiqueta y nadie elegiste nada
// todavia). Ver DesignBoardService.markApprovedVersionAttachment().
export class MarkApprovedVersionAttachmentDto {
  @IsBoolean()
  approved!: boolean;
}

// Pedido explicito del usuario, 28/oct/2026: buscador de archivo
// historico de bocetos archivados ("marcados como hechos"), para el Jefe
// de Diseño -- separado a proposito de ListDesignRequestsQueryDto/
// listRequests(): ese filtro vive atado al tablero del dia a dia (mes
// actual por defecto, sin paginacion porque siempre esta acotado a un
// mes) y este buscador es lo contrario -- sin limite de fecha salvo que
// se pida, y con paginacion real porque puede acumular años de historico.
// Ver DesignBoardService.searchArchive().
export class SearchArchivedDesignRequestsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(DESIGN_REQUEST_TYPES)
  requestType?: DesignRequestType;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsEnum(DesignRequestCountry)
  country?: DesignRequestCountry;

  // "YYYY-MM-DD", sobre archivedAt. Si se omiten los dos, no hay limite
  // de fecha (ese es justo el punto de este buscador).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limit?: number;
}

export class DesignBoardReportsQueryDto {
  // Pedido explicito del usuario, 25/oct/2026: las estadisticas ya no se
  // filtran por mes completo, sino por un rango de fechas (Desde/Hasta).
  // "YYYY-MM-DD"; si se omite cualquiera de los dos, se usa la semana en
  // curso (lunes a domingo) -- ver DesignBoardService.reportsDateRange().
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;
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

  // Pedido explicito del usuario, 27/oct/2026: reemplaza el set completo
  // de categorias de la solicitud (no es un "agregar" incremental) --
  // mandar [] las quita todas. Omitir el campo deja las categorias como
  // estaban (igual criterio que title/instructions/etc: solo se toca lo
  // que llega en el body).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  categoryIds?: string[];
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
