import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DesignAttachmentKind,
  DesignRequestCountry,
  Prisma,
  Role,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/prisma/prisma.service';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { LeadsService } from '../leads/leads.service';
import { OutboundService } from '../outbound/outbound.service';
import { ChatPolicyService } from '../outbound/chat-policy.service';
import { BusinessDaysService } from 'src/common/business-days/business-days.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { withLeadDisplayName } from 'src/common/utils/lead-name';
import {
  AddDesignRequestCommentDto,
  AssignDesignRequestDto,
  EditDesignRequestCommentDto,
  CreateDesignRequestAttachmentDto,
  CreateDesignRequestDto,
  DesignRequestType,
  ListDesignRequestsQueryDto,
  MoveDesignRequestDto,
} from './dto/create-design-request.dto';
import {
  DESIGN_REQUEST_EVENTS,
  DesignRequestApprovedEvent,
  DesignRequestCommentedEvent,
  DesignRequestReadyEvent,
  DesignRequestSentToModificationEvent,
} from './events/design-board.events';

export type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

// Nombre/codigo del tablero unico y global (ver ADR-004 §2 y §7, decision
// confirmada: "un solo tablero, global"). El MVP crea este tablero y sus 4
// columnas de forma perezosa (lazy) la primera vez que se necesitan, en vez
// de requerir un seed/migracion de datos separado.
const DEFAULT_BOARD_NAME = 'Bocetos';
const DEFAULT_COLUMNS = [
  { code: 'NEW', name: 'Bocetos nuevos', sortOrder: 0, isInitial: true },
  // Submodulo 4: se alcanza SOLO via sendToModification() (accion explicita
  // desde la columna isFinal), nunca por el movimiento generico +-1 -- ver
  // move() mas abajo, que salta esta columna al calcular el destino normal.
  {
    code: 'MODIFICATION',
    name: 'Modificación',
    sortOrder: 1,
    isModification: true,
    modificationSlaBusinessDays: 1,
  },
  { code: 'IN_REVIEW', name: 'Boceto en revisión', sortOrder: 2 },
  { code: 'DONE', name: 'Boceto terminado', sortOrder: 3, isFinal: true },
  { code: 'APPROVED', name: 'Aprobados', sortOrder: 4, isApproved: true },
] as const;

@Injectable()
export class DesignBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly outboundService: OutboundService,
    private readonly chatPolicyService: ChatPolicyService,
    private readonly businessDaysService: BusinessDaysService,
    private readonly chatEvents: ChatEventsService,
    // Bus de eventos de dominio EN PROCESO (Observer/EventEmitter2, ver
    // events/design-board.events.ts): este servicio publica "esto paso en
    // el tablero" y no conoce ni depende del sistema de notificaciones --
    // quien decide a quien avisar y como es DesignRequestNotificationsListener
    // (src/modules/notifications/listeners), no este archivo.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ADR-004 Submódulo 11: publica al mismo bus de eventos que ya usa el
  // chat (RabbitMQ + SSE vía ChatEventsService), en vez de una
  // infraestructura de tiempo real nueva. El payload es deliberadamente
  // liviano (solo IDs) -- la SPA reconsulta el estado real por REST al
  // recibir el evento, no confía en el contenido del evento en sí.
  private async emitDesignBoardEvent(
    type: 'design_request.created' | 'design_request.moved' | 'design_request.commented' | 'design_request.updated',
    request: { id: string; accountId: string; leadId: string },
    payload?: Record<string, unknown>,
  ) {
    await this.chatEvents.publish({
      type,
      accountId: request.accountId,
      leadId: request.leadId,
      payload: { designRequestId: request.id, ...payload },
    });
  }

  // -------------------------------------------------------------
  // Tablero / columnas (bootstrap perezoso del MVP)
  // -------------------------------------------------------------

  async getOrCreateDefaultBoard() {
    const existing = await this.prisma.designBoard.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      include: { columns: { orderBy: { sortOrder: 'asc' } } },
    });

    if (existing && existing.columns.length > 0) return existing;

    if (existing) {
      // Tablero existe pero (por lo que sea) sin columnas: las completa.
      await this.prisma.designBoardColumn.createMany({
        data: DEFAULT_COLUMNS.map((col) => ({
          boardId: existing.id,
          code: col.code,
          name: col.name,
          sortOrder: col.sortOrder,
          isInitial: 'isInitial' in col ? col.isInitial : false,
          isModification: 'isModification' in col ? col.isModification : false,
          modificationSlaBusinessDays:
            'modificationSlaBusinessDays' in col
              ? col.modificationSlaBusinessDays
              : null,
          isFinal: 'isFinal' in col ? col.isFinal : false,
          isApproved: 'isApproved' in col ? col.isApproved : false,
        })),
        skipDuplicates: true,
      });

      return this.prisma.designBoard.findFirstOrThrow({
        where: { id: existing.id },
        include: { columns: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    return this.prisma.designBoard.create({
      data: {
        name: DEFAULT_BOARD_NAME,
        columns: {
          create: DEFAULT_COLUMNS.map((col) => ({
            code: col.code,
            name: col.name,
            sortOrder: col.sortOrder,
            isInitial: 'isInitial' in col ? col.isInitial : false,
            isModification: 'isModification' in col ? col.isModification : false,
            modificationSlaBusinessDays:
              'modificationSlaBusinessDays' in col
                ? col.modificationSlaBusinessDays
                : null,
            isFinal: 'isFinal' in col ? col.isFinal : false,
            isApproved: 'isApproved' in col ? col.isApproved : false,
          })),
        },
      },
      include: { columns: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // -------------------------------------------------------------
  // Crear solicitud
  // -------------------------------------------------------------

  // Arma el `create` anidado de DesignRequestAttachment a partir de los
  // DTOs recibidos (createRequest y addComment comparten este shape).
  //
  // FROM_CHAT: el DTO solo trae sourceMessageId ("referencia a un Message
  // ya existente, sin copiar/descargar nada de nuevo" -- comentario
  // original del DTO). Eso significaba, hasta este fix, que el adjunto
  // quedaba SIN mediaUrl/mimeType/fileName propios -- lo cual rompia
  // forwardAttachment() (exige attachment.mediaUrl) y dejaba la UI sin
  // nada que mostrar. Se resuelve aca: se busca el Message, se valida que
  // sea del mismo lead (nunca confiar en un sourceMessageId arbitrario
  // que mande el cliente -- podria ser de otro lead/cuenta), y se
  // denormalizan sus campos de media sobre el attachment. Sigue sin
  // re-subir ni duplicar el archivo: mediaUrl apunta al mismo storage.
  private async buildAttachmentsCreateInput(
    leadId: string,
    attachments: CreateDesignRequestAttachmentDto[] | undefined,
    uploadedByUserId: string,
  ) {
    if (!attachments?.length) return undefined;

    const resolved = await Promise.all(
      attachments.map(async (att) => {
        if (att.kind !== DesignAttachmentKind.FROM_CHAT) {
          return {
            kind: att.kind,
            sourceMessageId: null,
            mediaUrl: att.mediaUrl ?? null,
            mediaStorageKey: att.mediaStorageKey ?? null,
            mimeType: att.mimeType ?? null,
            fileName: att.fileName ?? null,
            sizeBytes: att.sizeBytes ?? null,
            uploadedByUserId,
          };
        }

        if (!att.sourceMessageId) {
          throw new BadRequestException(
            'sourceMessageId es requerido para adjuntos FROM_CHAT',
          );
        }

        const message = await this.prisma.message.findUnique({
          where: { id: att.sourceMessageId },
          select: {
            id: true,
            leadId: true,
            mediaUrl: true,
            mediaStorageKey: true,
            mimeType: true,
            fileName: true,
            mediaSizeBytes: true,
          },
        });

        if (!message || message.leadId !== leadId) {
          throw new BadRequestException(
            'El mensaje referenciado no existe o no pertenece a este lead',
          );
        }

        if (!message.mediaUrl) {
          throw new BadRequestException(
            'El mensaje referenciado no tiene un archivo adjunto',
          );
        }

        return {
          kind: DesignAttachmentKind.FROM_CHAT,
          sourceMessageId: message.id,
          mediaUrl: message.mediaUrl,
          mediaStorageKey: message.mediaStorageKey,
          mimeType: message.mimeType,
          fileName: message.fileName,
          sizeBytes: message.mediaSizeBytes,
          uploadedByUserId,
        };
      }),
    );

    return resolved;
  }

  // -------------------------------------------------------------
  // Plazos diferenciados por tipo de solicitud (acordado con el cliente,
  // 02/oct/2026, a partir del documento "Explicacion boceto/modificacion/
  // repeticion"; actualizado 06/oct/2026: el tipo ya NO se infiere del
  // titulo por regex -- SALES/ADMIN lo elige explicitamente en el modal
  // de creacion via dto.requestType):
  //   - BOCETO (default si no se manda requestType): 3 dias habiles
  //     (default del tablero), salvo que la descripcion mencione un
  //     producto de plazo extendido (4 dias, ver mas abajo).
  //   - REPET_BOCETO: 2 dias habiles.
  //   - REPET_MOD / REPET_ANADE: 1 dia habil.
  //   - Mod / Mod Añade (cliente nuevo, boceto aun no cerrado): NO se
  //     eligen aca -- siguen usando el mecanismo ya existente de la
  //     columna "Modificacion" (sendToModification(), 1 dia habil), que
  //     ya cubre ambos casos por igual (confirmado con el cliente: misma
  //     SLA, mismo mecanismo).
  // La excepcion de 4 dias por producto (vasos/palas/paninis/hamburguesa
  // folding/ensaladeras) sigue detectandose por texto en la DESCRIPCION
  // (sin cambios), y solo aplica cuando el tipo elegido es BOCETO --
  // un REPET_BOCETO con esos productos en la descripcion sigue dando 2
  // dias (el tipo elegido manda).
  private static readonly REQUEST_TYPE_SLA_BUSINESS_DAYS: Partial<
    Record<DesignRequestType, number>
  > = {
    REPET_BOCETO: 2,
    REPET_MOD: 1,
    REPET_ANADE: 1,
  };

  private static readonly EXTENDED_SLA_PRODUCT_KEYWORDS = [
    'vaso',
    'pala',
    'panini',
    'hamburguesa folding',
    'ensaladera',
  ];

  private static readonly EXTENDED_SLA_BUSINESS_DAYS = 4;

  // Quita tildes/diacriticos y pasa a minusculas, para comparar texto
  // escrito a mano sin depender de que todos tipeen igual (con/sin tilde,
  // con/sin eñe, mayus/minus).
  private static normalizeForMatch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // Devuelve los dias habiles de plazo para una solicitud NUEVA segun el
  // tipo elegido explicitamente (requestType) y la descripcion, o null si
  // no aplica ninguna regla especial (en ese caso el caller usa el
  // default del tablero).
  private resolveCreationSlaBusinessDays(
    requestType: DesignRequestType | null | undefined,
    instructions: string | null | undefined,
  ): number | null {
    if (requestType && requestType !== 'BOCETO') {
      const days =
        DesignBoardService.REQUEST_TYPE_SLA_BUSINESS_DAYS[requestType];
      if (days !== undefined) {
        return days;
      }
    }

    // BOCETO (o sin requestType, que se trata como BOCETO) revisa la
    // descripcion por productos de plazo extendido.
    if (instructions) {
      const normalizedInstructions =
        DesignBoardService.normalizeForMatch(instructions);
      const hasExtendedProduct =
        DesignBoardService.EXTENDED_SLA_PRODUCT_KEYWORDS.some((keyword) =>
          normalizedInstructions.includes(keyword),
        );
      if (hasExtendedProduct) {
        return DesignBoardService.EXTENDED_SLA_BUSINESS_DAYS;
      }
    }

    return null;
  }

  async createRequest(user: AuthUser, dto: CreateDesignRequestDto) {
    if (user.role !== Role.SALES && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo SALES o ADMIN pueden crear solicitudes de boceto',
      );
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
      select: { id: true, accountId: true },
    });

    if (!lead || !lead.accountId) {
      throw new NotFoundException('Lead not found');
    }

    if (user.role === Role.SALES && lead.accountId !== user.accountId) {
      throw new ForbiddenException('El lead no pertenece a tu cuenta');
    }

    const board = await this.getOrCreateDefaultBoard();
    const initialColumn = board.columns.find((c) => c.isInitial);
    if (!initialColumn) {
      throw new BadRequestException(
        'El tablero no tiene una columna inicial configurada',
      );
    }

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    const now = new Date();
    // Plazo segun tipo de solicitud (ver resolveCreationSlaBusinessDays):
    // Repeticion Boceto/Mod/Añade detectado en el titulo, o el producto de
    // plazo extendido detectado en la descripcion; si ninguno aplica, cae
    // al default del tablero (3 dias habiles = Boceto normal).
    const requestSlaBusinessDays =
      this.resolveCreationSlaBusinessDays(dto.requestType, dto.instructions) ??
      board.defaultSlaDays;
    // ADR-004 SS7 (Submodulo 1): dias habiles + corte de las 14:00 hora
    // Europe/Madrid, en vez del placeholder de dias corridos del MVP core.
    const dueAt = this.businessDaysService.computeBusinessDueAt(
      now,
      requestSlaBusinessDays,
      holidaySet,
      { cutoffHour: board.slaCutoffHour },
    );

    const attachmentsCreateInput = await this.buildAttachmentsCreateInput(
      lead.id,
      dto.attachments,
      user.userId,
    );

    const designRequest = await this.prisma.$transaction(async (tx) => {
      const created = await tx.designRequest.create({
        data: {
          boardId: board.id,
          columnId: initialColumn.id,
          leadId: lead.id,
          accountId: lead.accountId!,
          title: dto.title,
          instructions: dto.instructions ?? null,
          country: dto.country ?? DesignRequestCountry.ES,
          createdByUserId: user.userId,
          slaBusinessDays: requestSlaBusinessDays,
          dueAt,
          attachments: attachmentsCreateInput
            ? { create: attachmentsCreateInput }
            : undefined,
        },
        include: { attachments: true },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: created.id,
          fromColumnId: null,
          toColumnId: initialColumn.id,
          direction: 'FORWARD',
          changedByUserId: user.userId,
        },
      });

      return created;
    });

    // Reusa el catalogo de labels ya existente (BOCETO_EN_PROCESO ya viene
    // sembrado como label de sistema, ver src/common/constants/lead-labels.ts)
    // en vez de crear infraestructura de etiquetas nueva.
    await this.leadsService.setLabel({
      accountId: lead.accountId,
      leadId: lead.id,
      label: SYSTEM_LABEL_CODES.BOCETO_EN_PROCESO,
      changedByUserId: user.userId,
    });

    await this.emitDesignBoardEvent('design_request.created', designRequest);

    return designRequest;
  }

  // -------------------------------------------------------------
  // Listar / detalle (con reglas de visibilidad por rol, ver ADR-004 §5)
  // -------------------------------------------------------------

  private visibilityWhere(
    user: AuthUser,
    query?: ListDesignRequestsQueryDto,
  ): Prisma.DesignRequestWhereInput {
    // ADR-004 Submódulo 8: "Aprobados" (isApproved) queda restringida a
    // DESIGNER_MANAGER/ADMIN -- SALES y DESIGNER nunca ven esas tarjetas,
    // archivadas o no.
    // Ademas (pedido explicito de negocio, 2026-09-30): SALES solo ve sus
    // propios bocetos y, dentro de esos, solo las columnas "Nuevos"
    // (isInitial) y "Terminado" (isFinal) -- nunca "Modificacion" ni "En
    // revision", que son estados internos del area de Diseno. Esto aplica
    // tanto al listado (listRequests) como al detalle (getRequestDetail,
    // que reusa este mismo where), asi que una tarjeta en un estado
    // intermedio tampoco es abrible por id -- assertCanView() (usado por
    // comentarios/adjuntos) es un chequeo aparte y no se ve afectado, asi
    // que SALES sigue pudiendo comentar mientras su boceto esta en esos
    // estados intermedios, solo no lo ve en el tablero.
    if (user.role === Role.SALES) {
      return {
        createdByUserId: user.userId,
        accountId: user.accountId ?? '__none__',
        column: { OR: [{ isInitial: true }, { isFinal: true }] },
      };
    }

    if (user.role === Role.DESIGNER) {
      return { assignedUserId: user.userId, column: { isApproved: false } };
    }

    // DESIGNER_MANAGER / ADMIN: sin restriccion, con filtros opcionales.
    return {
      ...(query?.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query?.createdByUserId
        ? { createdByUserId: query.createdByUserId }
        : {}),
    };
  }

  async listRequests(user: AuthUser, query: ListDesignRequestsQueryDto) {
    const where: Prisma.DesignRequestWhereInput = {
      ...this.visibilityWhere(user, query),
      ...(query.columnId ? { columnId: query.columnId } : {}),
      // ADR-004 Submódulo 8: el tablero excluye archivadas por defecto
      // (siguen existiendo íntegras para reportes/historial -- ver
      // getRequestDetail(), que sí las deja consultar por id).
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };

    // ADR-004 Submódulo 9: la columna "Terminado" (isFinal) filtra por
    // defecto al mes actual (según completedAt); completedMonth="all" ve
    // el histórico completo, o "YYYY-MM" un mes puntual.
    if (query.columnId) {
      const board = await this.getOrCreateDefaultBoard();
      const column = board.columns.find((c) => c.id === query.columnId);

      if (column?.isFinal && query.completedMonth !== 'all') {
        const { start, end } = this.monthRange(query.completedMonth);
        where.completedAt = { gte: start, lt: end };
      }
    }

    const requests = await this.prisma.designRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        column: true,
        attachments: true,
        lead: {
          select: {
            id: true,
            name: true,
            manualName: true,
            ycloudNickname: true,
            whatsappContactName: true,
            whatsappProfileName: true,
            phoneE164: true,
            accountId: true,
          },
        },
      },
    });

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    return requests.map((request) =>
      this.withSlaStatus(
        { ...request, lead: request.lead ? withLeadDisplayName(request.lead) : null },
        holidaySet,
      ),
    );
  }

  // "YYYY-MM" (o vacío/undefined = mes actual, en UTC) -> límites
  // [inicio, fin) del mes, para el filtro de la columna "Terminado".
  private monthRange(monthKey?: string): { start: Date; end: Date } {
    const now = new Date();
    const [year, month] = monthKey
      ? monthKey.split('-').map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { start, end };
  }

  async getRequestDetail(user: AuthUser, id: string) {
    const where: Prisma.DesignRequestWhereInput = {
      id,
      ...this.visibilityWhere(user),
    };

    const request = await this.prisma.designRequest.findFirst({
      where,
      include: {
        column: true,
        board: true,
        attachments: true,
        lead: {
          select: {
            id: true,
            name: true,
            manualName: true,
            ycloudNickname: true,
            whatsappContactName: true,
            whatsappProfileName: true,
            phoneE164: true,
            accountId: true,
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true },
        },
        statusEvents: { orderBy: { changedAt: 'asc' } },
      },
    });

    if (!request) throw new NotFoundException('Design request not found');

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    return this.withSlaStatus(
      { ...request, lead: request.lead ? withLeadDisplayName(request.lead) : null },
      holidaySet,
    );
  }

  // Semáforo de 3 colores (ADR-004 §8, Submódulo 1): verde si queda más de
  // 1 día hábil para `dueAt`, naranja si queda 1 día hábil o menos (vence
  // hoy o mañana hábil), rojo si ya venció. Una solicitud que ya llegó a
  // "Terminado" deja de considerarse en riesgo de atraso.
  private withSlaStatus<
    T extends { dueAt: Date; completedAt: Date | null; pausedAt?: Date | null },
  >(
    request: T,
    holidaySet: Set<string>,
  ): T & { slaStatus: 'GREEN' | 'ORANGE' | 'RED' | 'CLOSED' } {
    if (request.completedAt) {
      return { ...request, slaStatus: 'CLOSED' };
    }

    // ADR-004 Submódulo 5 (§4, §8): mientras está pausada, el semáforo se
    // "congela" -- en vez de guardar un color aparte, se recalcula usando
    // pausedAt como si fuera "ahora", así el color siempre refleja lo que
    // sería en el instante exacto de la pausa, sin un campo extra que
    // pueda desincronizarse.
    const now = request.pausedAt ?? new Date();
    if (now > request.dueAt) {
      return { ...request, slaStatus: 'RED' };
    }

    const businessDaysUntilDue = this.businessDaysService.businessDaysUntilDue(
      now,
      request.dueAt,
      holidaySet,
    );

    const slaStatus: 'GREEN' | 'ORANGE' =
      businessDaysUntilDue <= 1 ? 'ORANGE' : 'GREEN';

    return { ...request, slaStatus };
  }

  // Carga la solicitud sin filtro de visibilidad (uso interno, tras validar
  // el permiso especifico de cada accion) pero SIEMPRE existe / 404 si no.
  private async findOrThrow(id: string) {
    const request = await this.prisma.designRequest.findUnique({
      where: { id },
      include: { column: true, board: { include: { columns: true } } },
    });

    if (!request) throw new NotFoundException('Design request not found');

    return request;
  }

  private assertCanView(
    user: AuthUser,
    request: { createdByUserId: string; assignedUserId: string | null },
  ) {
    if (user.role === Role.ADMIN || user.role === Role.DESIGNER_MANAGER) return;

    if (user.role === Role.SALES) {
      if (request.createdByUserId !== user.userId) {
        throw new NotFoundException('Design request not found');
      }
      return;
    }

    if (user.role === Role.DESIGNER) {
      if (request.assignedUserId !== user.userId) {
        throw new NotFoundException('Design request not found');
      }
      return;
    }

    throw new ForbiddenException('No tienes acceso a este módulo');
  }

  // -------------------------------------------------------------
  // Asignar diseñador (solo DESIGNER_MANAGER/ADMIN)
  // -------------------------------------------------------------

  async assign(user: AuthUser, id: string, dto: AssignDesignRequestDto) {
    if (user.role !== Role.DESIGNER_MANAGER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo el Jefe de Diseño puede asignar solicitudes',
      );
    }

    const request = await this.findOrThrow(id);

    const designer = await this.prisma.user.findUnique({
      where: { id: dto.assignedUserId },
      select: { id: true, role: true },
    });

    if (!designer || designer.role !== Role.DESIGNER) {
      throw new BadRequestException('El usuario indicado no es un diseñador');
    }

    const updated = await this.prisma.designRequest.update({
      where: { id: request.id },
      data: {
        assignedUserId: designer.id,
        assignedAt: new Date(),
        assignedByUserId: user.userId,
      },
    });

    await this.emitDesignBoardEvent('design_request.updated', request);

    return updated;
  }

  // -------------------------------------------------------------
  // Mover ±1 columna (ver ADR-004 §2: nunca saltar mas de un paso)
  // -------------------------------------------------------------

  async move(user: AuthUser, id: string, dto: MoveDesignRequestDto) {
    if (user.role === Role.SALES) {
      throw new ForbiddenException('Las comerciales no mueven tarjetas del tablero');
    }

    const request = await this.findOrThrow(id);

    if (user.role === Role.DESIGNER && request.assignedUserId !== user.userId) {
      throw new NotFoundException('Design request not found');
    }

    // ADR-004 Submódulo 4: "Modificación" nunca se alcanza por el
    // movimiento genérico ±1 (solo vía sendToModification(), una acción
    // explícita desde la columna isFinal) -- así que el cálculo de destino
    // se hace sobre la secuencia de columnas SIN contar "Modificación",
    // salvo cuando la tarjeta ya está en esa columna (desde ahí, avanzar
    // ±1 sí es el movimiento normal hacia/desde "En revisión", ver §9.2).
    const ordered = request.board.columns.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const step = dto.direction === 'FORWARD' ? 1 : -1;

    let targetColumn: (typeof ordered)[number] | undefined;

    if (request.column.isModification) {
      const currentIndex = ordered.findIndex((c) => c.id === request.column.id);
      targetColumn = ordered[currentIndex + step];
    } else {
      const primaryPath = ordered.filter((c) => !c.isModification);
      const currentIndex = primaryPath.findIndex((c) => c.id === request.column.id);
      targetColumn = primaryPath[currentIndex + step];
    }

    if (!targetColumn) {
      throw new BadRequestException('No hay columna en esa dirección');
    }

    if (targetColumn.isApproved) {
      throw new BadRequestException(
        'Para pasar a "Aprobados" usa el endpoint de aprobación',
      );
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.designRequest.update({
        where: { id: request.id },
        data: {
          columnId: targetColumn.id,
          ...(targetColumn.isFinal ? { completedAt: now } : {}),
        },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: targetColumn.id,
          direction: dto.direction,
          changedByUserId: user.userId,
        },
      });

      return result;
    });

    if (targetColumn.isFinal) {
      this.eventEmitter.emit(
        DESIGN_REQUEST_EVENTS.READY,
        new DesignRequestReadyEvent(
          request.id,
          request.accountId,
          request.leadId,
          request.createdByUserId,
        ),
      );
    }

    await this.emitDesignBoardEvent('design_request.moved', request, {
      toColumnId: targetColumn.id,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // Enviar a "Modificación" (ADR-004 Submódulo 4, §2/§6/§9.2): acción
  // explícita, solo desde la columna isFinal ("Terminado"), reservada a
  // SALES (dueño de la solicitud), DESIGNER_MANAGER o ADMIN -- no es un
  // movimiento ±1 genérico. Reinicia el plazo (por defecto 1 día hábil) con
  // el mismo corte de las 14:00 hora España que usa createRequest().
  // -------------------------------------------------------------

  async sendToModification(user: AuthUser, id: string) {
    const request = await this.findOrThrow(id);

    const isOwnerSales = user.role === Role.SALES && request.createdByUserId === user.userId;
    const isManagerOrAdmin = user.role === Role.DESIGNER_MANAGER || user.role === Role.ADMIN;

    if (!isOwnerSales && !isManagerOrAdmin) {
      throw new ForbiddenException(
        'No tienes permiso para enviar esta solicitud a modificación',
      );
    }

    if (!request.column.isFinal) {
      throw new BadRequestException(
        'Solo se puede enviar a "Modificación" desde "Boceto terminado"',
      );
    }

    const modificationColumn = request.board.columns.find((c) => c.isModification);
    if (!modificationColumn) {
      throw new BadRequestException(
        'El tablero no tiene una columna de "Modificación" configurada',
      );
    }

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    const now = new Date();
    const slaBusinessDays = modificationColumn.modificationSlaBusinessDays ?? 1;
    const dueAt = this.businessDaysService.computeBusinessDueAt(
      now,
      slaBusinessDays,
      holidaySet,
      { cutoffHour: request.board.slaCutoffHour },
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.designRequest.update({
        where: { id: request.id },
        data: {
          columnId: modificationColumn.id,
          slaBusinessDays,
          dueAt,
          sentToModificationAt: now,
          // Se reinicia para que el cron de SLA (Submódulo 1) pueda volver
          // a aplicar BOCETOS_ATRASADOS bajo el nuevo plazo si corresponde.
          overdueLabelAppliedAt: null,
          // Fix: la tarjeta sale de "Terminado" -- si no se limpia,
          // completedAt queda con la fecha de la primera vez que llego a
          // "Terminado" y el filtro por mes / los reportes (que leen
          // completedAt) la siguen contando como terminada en ese mes
          // mientras esta dando vueltas en Modificacion/En revision.
          // move() ya vuelve a setear completedAt = now cuando la tarjeta
          // reingresa a "Terminado", asi que limpiarlo aca no pierde nada.
          completedAt: null,
        },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: modificationColumn.id,
          direction: 'SENT_TO_MODIFICATION',
          changedByUserId: user.userId,
        },
      });

      return result;
    });

    // ADR-004 Submódulo 6: alerta al diseñador asignado cuando su tarjeta
    // vuelve a "Modificación". Reescrito para publicar el evento de
    // dominio (ver events/design-board.events.ts) en vez de crear la
    // AppNotification aca mismo -- DesignRequestNotificationsListener
    // decide el destinatario (hoy: recipientUserId = assignedUserId).
    this.eventEmitter.emit(
      DESIGN_REQUEST_EVENTS.SENT_TO_MODIFICATION,
      new DesignRequestSentToModificationEvent(
        request.id,
        request.accountId,
        request.leadId,
        request.assignedUserId,
        now,
      ),
    );

    await this.emitDesignBoardEvent('design_request.moved', request, {
      toColumnId: modificationColumn.id,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // Comentarios
  // -------------------------------------------------------------

  async addComment(user: AuthUser, id: string, dto: AddDesignRequestCommentDto) {
    const request = await this.findOrThrow(id);
    this.assertCanView(user, request);

    // ADR-004 Submódulo 3: adjuntos dentro del comentario (mismo shape que
    // los adjuntos de la solicitud -- FROM_CHAT referencia un Message ya
    // existente, UPLOADED trae metadata de un archivo ya subido). Ver
    // buildAttachmentsCreateInput() para por que FROM_CHAT necesita
    // resolver el Message, no solo guardar el id.
    const attachmentsCreateInput = await this.buildAttachmentsCreateInput(
      request.leadId,
      dto.attachments,
      user.userId,
    );

    const comment = await this.prisma.designRequestComment.create({
      data: {
        designRequestId: request.id,
        authorUserId: user.userId,
        body: dto.body,
        attachments: attachmentsCreateInput
          ? { create: attachmentsCreateInput }
          : undefined,
      },
      include: { attachments: true },
    });

    // ADR-004 Submódulo 6 + §9.8: avisa "a la otra parte" -- si comenta la
    // comercial, al diseñador asignado; si comenta el diseñador o el
    // manager, a la comercial creadora. assertCanView() ya garantiza que
    // solo puede comentar la SALES dueña, el DESIGNER asignado, o
    // MANAGER/ADMIN. Reescrito para publicar el evento de dominio en vez
    // de decidir el destinatario aca -- DesignRequestNotificationsListener
    // (src/modules/notifications/listeners) es el UNICO lugar que aplica
    // esa regla ahora, con el campo AppNotification.recipientUserId.
    this.eventEmitter.emit(
      DESIGN_REQUEST_EVENTS.COMMENTED,
      new DesignRequestCommentedEvent(
        request.id,
        comment.id,
        request.accountId,
        request.leadId,
        user.userId,
        user.role,
        request.createdByUserId,
        request.assignedUserId,
      ),
    );

    await this.emitDesignBoardEvent('design_request.commented', request, {
      commentId: comment.id,
    });

    return comment;
  }

  // Solo el autor puede editar su propio comentario; nadie mas (ni ADMIN /
  // DESIGNER_MANAGER) puede reescribir palabras de otra persona -- eso es
  // distinto a moderar (borrar), que si se permite mas abajo.
  async editComment(
    user: AuthUser,
    id: string,
    commentId: string,
    dto: EditDesignRequestCommentDto,
  ) {
    const request = await this.findOrThrow(id);
    this.assertCanView(user, request);

    const comment = await this.prisma.designRequestComment.findFirst({
      where: { id: commentId, designRequestId: request.id },
    });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    if (comment.authorUserId !== user.userId) {
      throw new ForbiddenException('Solo puedes editar tus propios comentarios');
    }

    const updated = await this.prisma.designRequestComment.update({
      where: { id: comment.id },
      data: { body: dto.body, editedAt: new Date() },
      include: { attachments: true },
    });

    await this.emitDesignBoardEvent('design_request.updated', request, {
      commentId: comment.id,
    });

    return updated;
  }

  // El autor puede borrar su propio comentario; ADMIN/DESIGNER_MANAGER
  // pueden borrar cualquiera (moderacion), igual que ya pueden ver/operar
  // sobre cualquier solicitud del tablero (ADR-004 SS5).
  async deleteComment(user: AuthUser, id: string, commentId: string) {
    const request = await this.findOrThrow(id);
    this.assertCanView(user, request);

    const comment = await this.prisma.designRequestComment.findFirst({
      where: { id: commentId, designRequestId: request.id },
    });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    const isAuthor = comment.authorUserId === user.userId;
    const isModerator =
      user.role === Role.ADMIN || user.role === Role.DESIGNER_MANAGER;
    if (!isAuthor && !isModerator) {
      throw new ForbiddenException('Solo puedes eliminar tus propios comentarios');
    }

    // onDelete: Cascade en DesignRequestAttachment.commentId se lleva
    // tambien los adjuntos colgados de este comentario (Submodulo 3).
    await this.prisma.designRequestComment.delete({ where: { id: comment.id } });

    await this.emitDesignBoardEvent('design_request.updated', request, {
      commentId: comment.id,
      deleted: true,
    });

    return { id: comment.id };
  }

  // -------------------------------------------------------------
  // Adjuntos: eliminar (Submodulo 3)
  // -------------------------------------------------------------

  // Un adjunto puede colgar directo de la solicitud o de uno de sus
  // comentarios (ver nota en el schema) -- se busca en ambos lugares.
  private async findAttachmentInRequest(requestId: string, attachmentId: string) {
    const attachment = await this.prisma.designRequestAttachment.findFirst({
      where: {
        id: attachmentId,
        OR: [{ designRequestId: requestId }, { comment: { designRequestId: requestId } }],
      },
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado');
    return attachment;
  }

  // Quien lo subio puede quitarlo, y ADMIN/DESIGNER_MANAGER pueden quitar
  // cualquier adjunto (moderacion). Esto no borra nada en el chat de
  // WhatsApp original si el adjunto vino de ahi (FROM_CHAT) -- solo quita
  // la referencia dentro del tablero de bocetos.
  async deleteAttachment(user: AuthUser, id: string, attachmentId: string) {
    const request = await this.findOrThrow(id);
    this.assertCanView(user, request);

    const attachment = await this.findAttachmentInRequest(request.id, attachmentId);

    const isUploader = attachment.uploadedByUserId === user.userId;
    const isModerator =
      user.role === Role.ADMIN || user.role === Role.DESIGNER_MANAGER;
    if (!isUploader && !isModerator) {
      throw new ForbiddenException('No puedes eliminar este adjunto');
    }

    await this.prisma.designRequestAttachment.delete({ where: { id: attachment.id } });

    await this.emitDesignBoardEvent('design_request.updated', request, {
      attachmentId: attachment.id,
      deleted: true,
    });

    return { id: attachment.id };
  }

  // -------------------------------------------------------------
  // Aprobar (Terminado -> Aprobados)
  // -------------------------------------------------------------

  async approve(user: AuthUser, id: string) {
    const request = await this.findOrThrow(id);

    const isOwnerSales = user.role === Role.SALES && request.createdByUserId === user.userId;
    const isManagerOrAdmin = user.role === Role.DESIGNER_MANAGER || user.role === Role.ADMIN;

    if (!isOwnerSales && !isManagerOrAdmin) {
      throw new ForbiddenException('No puedes aprobar esta solicitud');
    }

    if (!request.column.isFinal) {
      throw new BadRequestException(
        'Solo se puede aprobar una solicitud que esté en "Boceto terminado"',
      );
    }

    const approvedColumn = request.board.columns.find((c) => c.isApproved);
    if (!approvedColumn) {
      throw new BadRequestException(
        'El tablero no tiene una columna de aprobados configurada',
      );
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.designRequest.update({
        where: { id: request.id },
        data: { columnId: approvedColumn.id, approvedAt: now },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: approvedColumn.id,
          direction: 'FORWARD',
          changedByUserId: user.userId,
        },
      });

      return result;
    });

    this.eventEmitter.emit(
      DESIGN_REQUEST_EVENTS.APPROVED,
      new DesignRequestApprovedEvent(
        request.id,
        request.accountId,
        request.leadId,
        request.assignedUserId,
        now,
      ),
    );

    await this.emitDesignBoardEvent('design_request.moved', request, {
      toColumnId: approvedColumn.id,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // Reenviar un adjunto (normalmente el boceto terminado) al lead por
  // WhatsApp, reusando el envío de medios ya implementado en OutboundService
  // (POST /outbound/media) en vez de construir un pipeline nuevo.
  // -------------------------------------------------------------

  async forwardAttachment(user: AuthUser, id: string, attachmentId: string) {
    const request = await this.findOrThrow(id);

    const isOwnerSales =
      user.role === Role.SALES && request.createdByUserId === user.userId;
    const isAdmin = user.role === Role.ADMIN;

    if (!isOwnerSales && !isAdmin) {
      throw new ForbiddenException(
        'No puedes reenviar adjuntos de esta solicitud',
      );
    }

    // Los adjuntos que la propia comercial sube al crear la solicitud (o
    // luego, directo sobre la tarjeta) son material de ENTRADA para el
    // diseñador -- nunca lo que se reenvia al lead. Lo que se reenvia es el
    // boceto ya terminado, que el diseñador deja en un COMENTARIO al pasar
    // la tarjeta a "Terminado" -- por eso este lookup, igual que
    // findAttachmentInRequest(), busca tanto en designRequestId como dentro
    // de un comentario de esta misma solicitud.
    const attachment = await this.prisma.designRequestAttachment.findFirst({
      where: {
        id: attachmentId,
        OR: [{ designRequestId: request.id }, { comment: { designRequestId: request.id } }],
      },
    });

    if (!attachment) {
      throw new NotFoundException('Adjunto no encontrado');
    }

    if (!attachment.mediaUrl) {
      throw new BadRequestException(
        'Este adjunto no tiene un archivo asociado para reenviar',
      );
    }

    const mediaType = this.mapMimeTypeToOutboundMediaType(
      attachment.mimeType,
    );

    // WhatsApp solo permite mensajes libres (imagen/documento sueltos)
    // mientras la ventana de servicio al cliente de 24h esta abierta. Si ya
    // se cerro, la unica forma de reenviar es via plantilla aprobada -- acá
    // detectamos eso de antemano (en vez de dejar que YCloud/ChatPolicy
    // tire un 400) y elegimos automaticamente la plantilla generica de
    // "boceto terminado" que corresponda segun el tipo de archivo (jpg vs
    // pdf), inyectando el archivo real de esta solicitud como media del
    // header en ese envio puntual.
    const policy = await this.chatPolicyService.getPolicy(
      request.accountId,
      request.leadId,
    );

    const sent = policy.isCustomerWindowOpen
      ? await this.outboundService.sendMediaMessage({
          accountId: request.accountId,
          leadId: request.leadId,
          clientRequestId: `design_request_forward:${attachment.id}`,
          type: mediaType,
          mediaUrl: attachment.mediaUrl,
          mediaStorageKey: attachment.mediaStorageKey ?? null,
          mediaSizeBytes: attachment.sizeBytes ?? null,
          caption: null,
          fileName: attachment.fileName ?? null,
        })
      : await this.forwardAttachmentViaTemplate(request, attachment, mediaType);

    await this.prisma.designRequestAttachment.update({
      where: { id: attachment.id },
      data: { forwardedToLeadAt: new Date() },
    });

    return sent;
  }

  // -------------------------------------------------------------
  // Fallback de "Reenviar al lead" cuando la ventana de 24h esta cerrada:
  // selecciona entre las dos plantillas genericas de boceto (una con header
  // IMAGE para el jpg, otra con header DOCUMENT para el pdf) segun el mime
  // type del adjunto, y la envia inyectando el archivo real de esta
  // solicitud como override del media del header (ver
  // resolveTemplateComponentsForSend en OutboundService), en vez del
  // ejemplo generico que Meta guarda al aprobar la plantilla.
  //
  // Nombres fijos ya registrados/aprobados en Meta/YCloud para esta cuenta.
  // Si en el futuro cambian o hay que soportar mas de una cuenta con
  // nombres distintos, mover esto a configuracion.
  // -------------------------------------------------------------
  // "boceto_jpg" quedo bloqueada por Meta: en algunos WABA, Meta le
  // asocio categoria MARKETING en algun momento (aunque ya no quede nada
  // vivo con ese nombre+idioma ahi) y no deja volver a crearla como
  // UTILITY -- ver conversacion con el equipo del 01/oct/2026. Se creo
  // "boceto_jpg2" desde cero como UTILITY para evitar ese bloqueo
  // historico; "boceto_pdf" no tuvo el mismo problema y se deja igual.
  private static readonly BOCETO_TEMPLATE_NAMES: Record<
    'image' | 'document',
    string
  > = {
    image: 'boceto_jpg2',
    document: 'boceto_pdf',
  };

  private async forwardAttachmentViaTemplate(
    request: { accountId: string; leadId: string },
    attachment: {
      id: string;
      mediaUrl: string | null;
      fileName: string | null;
    },
    mediaType: 'image' | 'audio' | 'video' | 'document',
  ) {
    if (mediaType !== 'image' && mediaType !== 'document') {
      throw new BadRequestException(
        'La ventana de 24 horas de WhatsApp esta cerrada y este tipo de archivo no tiene una plantilla de reenvio configurada (solo imagen o documento/pdf).',
      );
    }

    const templateName =
      DesignBoardService.BOCETO_TEMPLATE_NAMES[mediaType];

    if (!attachment.mediaUrl) {
      throw new BadRequestException(
        'Este adjunto no tiene un archivo asociado para reenviar',
      );
    }

    // No pasamos languageCode: sendTemplateMessage ya resuelve el idioma
    // como en el resto del sistema (lead.preferredLanguage, con 'es_ES'
    // como ultimo fallback), asi que la plantilla sigue el idioma del
    // lead igual que cualquier otro envio.
    return this.outboundService.sendTemplateMessage({
      accountId: request.accountId,
      leadId: request.leadId,
      clientRequestId: `design_request_forward_template:${attachment.id}`,
      templateName,
      headerMediaOverride: {
        url: attachment.mediaUrl,
        fileName: attachment.fileName ?? null,
      },
    });
  }

  // -------------------------------------------------------------
  // Archivar ("Marcar como hecho" desde Aprobados -- ADR-004 Submódulo 8)
  // -------------------------------------------------------------

  async archive(user: AuthUser, id: string) {
    if (user.role !== Role.DESIGNER_MANAGER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo el Jefe de Diseño puede archivar solicitudes',
      );
    }

    const request = await this.findOrThrow(id);

    if (!request.column.isApproved) {
      throw new BadRequestException(
        'Solo se puede archivar una solicitud que esté en "Aprobados"',
      );
    }

    if (request.archivedAt) {
      throw new BadRequestException('Esta solicitud ya está archivada');
    }

    const updated = await this.prisma.designRequest.update({
      where: { id: request.id },
      data: { archivedAt: new Date(), archivedByUserId: user.userId },
    });

    await this.emitDesignBoardEvent('design_request.updated', request);

    return updated;
  }

  // -------------------------------------------------------------
  // Pausar / reanudar el plazo (ADR-004 Submódulo 5, §2/§4/§8): únicamente
  // DESIGNER_MANAGER/ADMIN. No tiene sentido pausar una solicitud que ya
  // salió del flujo activo (Terminado/Aprobados/archivada) -- ahí el
  // semáforo ya está en CLOSED y no hay plazo corriendo.
  // -------------------------------------------------------------

  async pause(user: AuthUser, id: string) {
    if (user.role !== Role.DESIGNER_MANAGER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo el Jefe de Diseño puede pausar el plazo',
      );
    }

    const request = await this.findOrThrow(id);

    if (request.completedAt || request.archivedAt) {
      throw new BadRequestException(
        'No se puede pausar una solicitud que ya salió del flujo activo',
      );
    }

    if (request.pausedAt) {
      throw new BadRequestException('Esta solicitud ya está pausada');
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.designRequest.update({
        where: { id: request.id },
        data: { pausedAt: now, pausedByUserId: user.userId },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: request.column.id,
          direction: 'PAUSED',
          changedByUserId: user.userId,
        },
      });

      return updated;
    }).then(async (updated) => {
      await this.emitDesignBoardEvent('design_request.updated', request);
      return updated;
    });
  }

  async resume(user: AuthUser, id: string) {
    if (user.role !== Role.DESIGNER_MANAGER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo el Jefe de Diseño puede reanudar el plazo',
      );
    }

    const request = await this.findOrThrow(id);

    if (!request.pausedAt) {
      throw new BadRequestException('Esta solicitud no está pausada');
    }

    const now = new Date();
    const elapsedMs = now.getTime() - request.pausedAt.getTime();

    // ADR-004 §4, nota de diseño (simplificación deliberada, ver 🔶 §9.7):
    // en vez de recalcular días hábiles parciales, se desplaza dueAt hacia
    // adelante por el tiempo real (en ms) que estuvo pausada.
    const newDueAt = new Date(request.dueAt.getTime() + elapsedMs);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.designRequest.update({
        where: { id: request.id },
        data: {
          pausedAt: null,
          pausedByUserId: null,
          pausedTotalMs: request.pausedTotalMs + BigInt(elapsedMs),
          dueAt: newDueAt,
        },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: request.column.id,
          direction: 'RESUMED',
          changedByUserId: user.userId,
        },
      });

      return updated;
    }).then(async (updated) => {
      await this.emitDesignBoardEvent('design_request.updated', request);
      return updated;
    });
  }

  // -------------------------------------------------------------
  // Reportes y estadísticas (ADR-004 Submódulo 10, §10): solo
  // DESIGNER_MANAGER/ADMIN. A propósito NO filtra por archivedAt -- el
  // histórico completo cuenta para las métricas, archivado o no (ver §10:
  // "el archivado solo las saca del tablero visual, no de las
  // estadísticas").
  // -------------------------------------------------------------

  async getReportsSummary(user: AuthUser, query: { month?: string }) {
    if (user.role !== Role.DESIGNER_MANAGER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Solo el Jefe de Diseño puede ver los reportes',
      );
    }

    const { start, end } = this.monthRange(query.month);
    const monthKey =
      query.month ??
      `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;

    // Cohorte por mes de TERMINADO (06/oct/2026, correccion pedida por el
    // cliente): un boceto terminado en un mes pero aprobado recien en un
    // mes posterior debe contar como aprobado del mes en que se termino,
    // no del mes en que se aprobo -- antes `approvedCount`/los breakdowns
    // se filtraban por `approvedAt` (mes de la aprobacion), lo que podia
    // dar aprobados > terminados o un 0% enganoso cuando la aprobacion
    // caia en otro mes. Ahora todo se filtra por `completedAt` dentro del
    // mes pedido, y "aprobado" simplemente exige `approvedAt` no nulo
    // (sin importar en que mes caiga esa fecha).
    const completedInMonth = { completedAt: { gte: start, lt: end } };
    const approvedFromMonthCohort = {
      ...completedInMonth,
      approvedAt: { not: null },
    };

    const [completedCount, approvedCount, approvedByCountry, approvedByCreator] =
      await Promise.all([
        this.prisma.designRequest.count({
          where: completedInMonth,
        }),
        this.prisma.designRequest.count({
          where: approvedFromMonthCohort,
        }),
        this.prisma.designRequest.groupBy({
          by: ['country'],
          where: approvedFromMonthCohort,
          _count: { _all: true },
        }),
        this.prisma.designRequest.groupBy({
          by: ['createdByUserId'],
          where: approvedFromMonthCohort,
          _count: { _all: true },
        }),
      ]);

    // ADR-004 §10: aprobados (cohorte de terminados del mes) / terminados del período.
    const approvalRate =
      completedCount > 0 ? (approvedCount / completedCount) * 100 : 0;

    return {
      month: monthKey,
      completedCount,
      approvedCount,
      approvalRate,
      approvedByCountry: approvedByCountry.map((row: any) => ({
        country: row.country,
        count: row._count._all,
      })),
      approvedByCreator: approvedByCreator.map((row: any) => ({
        createdByUserId: row.createdByUserId,
        count: row._count._all,
      })),
    };
  }

  // -------------------------------------------------------------
  // Tasa de aprobación personal por comercial, últimos 3 meses
  // (pedido por el cliente 07/oct/2026): cada SALES puede ver su propia
  // tasa de aprobación (no la de otros comerciales), desglosada mes por
  // mes, de SUS solicitudes de boceto presentadas (createdByUserId).
  // Misma cohorte que getReportsSummary: un boceto cuenta como
  // "aprobado" del mes en que se TERMINÓ (completedAt), aunque la
  // aprobación (approvedAt) haya llegado despues, en un mes posterior.
  // -------------------------------------------------------------

  async getMyMonthlyApprovalRate(user: AuthUser) {
    if (user.role !== Role.SALES) {
      throw new ForbiddenException(
        'Esta vista es solo para comerciales (SALES)',
      );
    }

    // Los ultimos 3 meses, incluyendo el actual, ordenados del mas
    // antiguo al mas reciente (para leer la tendencia de izquierda a
    // derecha en el widget).
    const now = new Date();
    const months: { start: Date; end: Date; monthKey: string }[] = [];
    for (let offset = 2; offset >= 0; offset -= 1) {
      // UTC Date normaliza meses negativos/fuera de rango automaticamente
      // (ej. mes actual=0/enero, offset=2 -> month=-1 -> noviembre del
      // año anterior), asi que no hace falta un chequeo de borde propio.
      const shifted = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
      );
      const monthKey = `${shifted.getUTCFullYear()}-${String(
        shifted.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      const { start, end } = this.monthRange(monthKey);
      months.push({ start, end, monthKey });
    }

    const rows = await Promise.all(
      months.map(async ({ start, end, monthKey }) => {
        const completedInMonth = {
          createdByUserId: user.userId,
          completedAt: { gte: start, lt: end },
        };
        const [completedCount, approvedCount] = await Promise.all([
          this.prisma.designRequest.count({ where: completedInMonth }),
          this.prisma.designRequest.count({
            where: { ...completedInMonth, approvedAt: { not: null } },
          }),
        ]);

        const approvalRate =
          completedCount > 0 ? (approvedCount / completedCount) * 100 : 0;

        return { month: monthKey, completedCount, approvedCount, approvalRate };
      }),
    );

    return { months: rows };
  }

  // -------------------------------------------------------------
  // Aprobación automática por etiqueta (ADR-004 Submódulo 2): invocado por
  // LeadsController.setLabel cuando alguien le pone BOCETO_APROBADO a un
  // lead. Mueve la solicitud en "Terminado" a "Aprobados", o bloquea la
  // etiqueta (lanzando) si no hay ninguna solicitud esperando aprobación.
  // -------------------------------------------------------------

  async approveByLabel(accountId: string, leadId: string, userId?: string) {
    const request = await this.prisma.designRequest.findFirst({
      where: {
        accountId,
        leadId,
        approvedAt: null,
        column: { isFinal: true },
      },
      orderBy: { completedAt: 'desc' },
      include: { column: true, board: { include: { columns: true } } },
    });

    if (!request) {
      throw new BadRequestException(
        'No hay ninguna solicitud de boceto en "Boceto terminado" esperando aprobación para este lead',
      );
    }

    const approvedColumn = request.board.columns.find((c) => c.isApproved);
    if (!approvedColumn) {
      throw new BadRequestException(
        'El tablero no tiene una columna de aprobados configurada',
      );
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.designRequest.update({
        where: { id: request.id },
        data: {
          columnId: approvedColumn.id,
          approvedAt: now,
          approvedViaLabel: true,
        },
      });

      await tx.designRequestStatusEvent.create({
        data: {
          designRequestId: request.id,
          fromColumnId: request.column.id,
          toColumnId: approvedColumn.id,
          direction: 'AUTO_APPROVED',
          changedByUserId: userId ?? null,
        },
      });

      return result;
    });

    this.eventEmitter.emit(
      DESIGN_REQUEST_EVENTS.APPROVED,
      new DesignRequestApprovedEvent(
        request.id,
        request.accountId,
        request.leadId,
        request.assignedUserId,
        now,
      ),
    );

    await this.emitDesignBoardEvent('design_request.moved', request, {
      toColumnId: approvedColumn.id,
    });

    return updated;
  }

  private mapMimeTypeToOutboundMediaType(
    mimeType: string | null,
  ): 'image' | 'audio' | 'video' | 'document' {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }
}
