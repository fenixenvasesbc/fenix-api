import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppNotificationType,
  DesignAttachmentKind,
  DesignRequestCountry,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SYSTEM_LABEL_CODES } from 'src/common/constants/lead-labels';
import { LeadsService } from '../leads/leads.service';
import { OutboundService } from '../outbound/outbound.service';
import { BusinessDaysService } from 'src/common/business-days/business-days.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import {
  AddDesignRequestCommentDto,
  AssignDesignRequestDto,
  CreateDesignRequestDto,
  ListDesignRequestsQueryDto,
  MoveDesignRequestDto,
} from './dto/create-design-request.dto';

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
    private readonly businessDaysService: BusinessDaysService,
    private readonly chatEvents: ChatEventsService,
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
    // ADR-004 SS7 (Submodulo 1): dias habiles + corte de las 14:00 hora
    // Europe/Madrid, en vez del placeholder de dias corridos del MVP core.
    const dueAt = this.businessDaysService.computeBusinessDueAt(
      now,
      board.defaultSlaDays,
      holidaySet,
      { cutoffHour: board.slaCutoffHour },
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
          slaBusinessDays: board.defaultSlaDays,
          dueAt,
          attachments: dto.attachments?.length
            ? {
                create: dto.attachments.map((att) => ({
                  kind: att.kind,
                  sourceMessageId:
                    att.kind === DesignAttachmentKind.FROM_CHAT
                      ? (att.sourceMessageId ?? null)
                      : null,
                  mediaUrl: att.mediaUrl ?? null,
                  mediaStorageKey: att.mediaStorageKey ?? null,
                  mimeType: att.mimeType ?? null,
                  fileName: att.fileName ?? null,
                  sizeBytes: att.sizeBytes ?? null,
                  uploadedByUserId: user.userId,
                })),
              }
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
    if (user.role === Role.SALES) {
      return {
        createdByUserId: user.userId,
        accountId: user.accountId ?? '__none__',
        column: { isApproved: false },
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
        lead: { select: { id: true, displayName: true, phoneE164: true, accountId: true } },
      },
    });

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    return requests.map((request) => this.withSlaStatus(request, holidaySet));
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
        lead: { select: { id: true, displayName: true, phoneE164: true, accountId: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true },
        },
        statusEvents: { orderBy: { changedAt: 'asc' } },
      },
    });

    if (!request) throw new NotFoundException('Design request not found');

    const holidaySet = await this.businessDaysService.loadHolidaySet();
    return this.withSlaStatus(request, holidaySet);
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
      await this.notifyDesignRequestReady(request.id, request.accountId, request.leadId);
    }

    await this.emitDesignBoardEvent('design_request.moved', request, {
      toColumnId: targetColumn.id,
    });

    return updated;
  }

  private async notifyDesignRequestReady(
    designRequestId: string,
    accountId: string,
    leadId: string,
  ) {
    const dedupeKey = `design_request_ready:${designRequestId}`;

    await this.prisma.appNotification.upsert({
      where: { accountId_dedupeKey: { accountId, dedupeKey } },
      update: {},
      create: {
        accountId,
        leadId,
        type: AppNotificationType.DESIGN_REQUEST_READY,
        dedupeKey,
        title: 'Boceto terminado',
        message: 'Un boceto que pediste ya está listo para tu revisión.',
      },
    });
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
    // vuelve a "Modificación". Simplificación heredada de
    // notifyDesignRequestReady(): la notificación vive a nivel
    // cuenta/lead (AppNotification no modela destinatarios por usuario en
    // este esquema), no una bandeja individual por DESIGNER.
    await this.prisma.appNotification.create({
      data: {
        accountId: request.accountId,
        leadId: request.leadId,
        type: AppNotificationType.DESIGN_REQUEST_SENT_TO_MODIFICATION,
        dedupeKey: `design_request_sent_to_modification:${request.id}:${now.getTime()}`,
        title: 'Boceto enviado a modificación',
        message: 'Un boceto que tenías asignado volvió a "Modificación".',
      },
    });

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
    // existente, UPLOADED trae metadata de un archivo ya subido).
    const comment = await this.prisma.designRequestComment.create({
      data: {
        designRequestId: request.id,
        authorUserId: user.userId,
        body: dto.body,
        attachments: dto.attachments?.length
          ? {
              create: dto.attachments.map((att) => ({
                kind: att.kind,
                sourceMessageId:
                  att.kind === DesignAttachmentKind.FROM_CHAT
                    ? (att.sourceMessageId ?? null)
                    : null,
                mediaUrl: att.mediaUrl ?? null,
                mediaStorageKey: att.mediaStorageKey ?? null,
                mimeType: att.mimeType ?? null,
                fileName: att.fileName ?? null,
                sizeBytes: att.sizeBytes ?? null,
                uploadedByUserId: user.userId,
              })),
            }
          : undefined,
      },
      include: { attachments: true },
    });

    // ADR-004 Submódulo 6 + §9.8: avisa "a la otra parte" -- si comenta la
    // comercial, al diseñador asignado; si comenta el diseñador o el
    // manager, a la comercial creadora. assertCanView() ya garantiza que
    // solo puede comentar la SALES dueña, el DESIGNER asignado, o
    // MANAGER/ADMIN, así que siempre hay una "otra parte" a avisar.
    // Simplificación heredada de notifyDesignRequestReady(): la
    // notificación vive a nivel cuenta/lead (AppNotification no modela
    // destinatarios por usuario en este esquema).
    await this.prisma.appNotification.create({
      data: {
        accountId: request.accountId,
        leadId: request.leadId,
        type: AppNotificationType.DESIGN_REQUEST_COMMENTED,
        dedupeKey: `design_request_commented:${comment.id}`,
        title: 'Nuevo comentario en un boceto',
        message: 'Hay un comentario nuevo en una solicitud de boceto.',
      },
    });

    await this.emitDesignBoardEvent('design_request.commented', request, {
      commentId: comment.id,
    });

    return comment;
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

    const attachment = await this.prisma.designRequestAttachment.findFirst({
      where: { id: attachmentId, designRequestId: request.id },
    });

    if (!attachment) {
      throw new NotFoundException('Adjunto no encontrado');
    }

    if (!attachment.mediaUrl) {
      throw new BadRequestException(
        'Este adjunto no tiene un archivo asociado para reenviar',
      );
    }

    const sent = await this.outboundService.sendMediaMessage({
      accountId: request.accountId,
      leadId: request.leadId,
      clientRequestId: `design_request_forward:${attachment.id}`,
      type: this.mapMimeTypeToOutboundMediaType(attachment.mimeType),
      mediaUrl: attachment.mediaUrl,
      mediaStorageKey: attachment.mediaStorageKey ?? null,
      mediaSizeBytes: attachment.sizeBytes ?? null,
      caption: null,
      fileName: attachment.fileName ?? null,
    });

    await this.prisma.designRequestAttachment.update({
      where: { id: attachment.id },
      data: { forwardedToLeadAt: new Date() },
    });

    return sent;
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

    const [completedCount, approvedCount, approvedByCountry, approvedByCreator] =
      await Promise.all([
        this.prisma.designRequest.count({
          where: { completedAt: { gte: start, lt: end } },
        }),
        this.prisma.designRequest.count({
          where: { approvedAt: { gte: start, lt: end } },
        }),
        this.prisma.designRequest.groupBy({
          by: ['country'],
          where: { approvedAt: { gte: start, lt: end } },
          _count: { _all: true },
        }),
        this.prisma.designRequest.groupBy({
          by: ['createdByUserId'],
          where: { approvedAt: { gte: start, lt: end } },
          _count: { _all: true },
        }),
      ]);

    // ADR-004 §10 / asunción 🔶 §9.13: aprobados / terminados del período.
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
