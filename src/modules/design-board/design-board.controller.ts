import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { filter, map, merge, interval, Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { DesignBoardService, AuthUser } from './design-board.service';
import {
  AddDesignRequestCommentDto,
  ApproveDesignRequestDto,
  AssignDesignRequestDto,
  CreateDesignRequestDto,
  DesignBoardReportsQueryDto,
  EditDesignRequestCommentDto,
  ListDesignRequestsQueryDto,
  MarkApprovedVersionAttachmentDto,
  MoveDesignRequestDto,
  SearchArchivedDesignRequestsQueryDto,
  UpdateDesignRequestDto,
} from './dto/create-design-request.dto';

@Controller('design-board')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DesignBoardController {
  constructor(
    private readonly designBoardService: DesignBoardService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Post('requests')
  createRequest(
    @Req() req: { user: AuthUser },
    @Body() dto: CreateDesignRequestDto,
  ) {
    return this.designBoardService.createRequest(req.user, dto);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Get('requests')
  listRequests(
    @Req() req: { user: AuthUser },
    @Query() query: ListDesignRequestsQueryDto,
  ) {
    return this.designBoardService.listRequests(req.user, query);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Get('requests/:id')
  getRequestDetail(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.getRequestDetail(req.user, id);
  }

  // Edicion de titulo/descripcion/pais/tipo por la comercial propietaria --
  // el service valida la propiedad (createdByUserId) y que no este
  // archivada; aca se habilita el rol igual que en createRequest
  // (ADMIN, SALES) para no duplicar esa regla en dos lugares.
  @Roles(Role.ADMIN, Role.SALES)
  @Patch('requests/:id')
  updateRequest(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDesignRequestDto,
  ) {
    return this.designBoardService.updateRequest(req.user, id, dto);
  }

  // Eliminacion logica por la comercial propietaria -- pedido explicito
  // del usuario, 23/oct/2026 (ver DesignBoardService.deleteRequest). Mismo
  // criterio de rol que updateRequest/createRequest.
  @Roles(Role.ADMIN, Role.SALES)
  @Delete('requests/:id')
  deleteRequest(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.deleteRequest(req.user, id);
  }

  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Patch('requests/:id/assign')
  assign(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDesignRequestDto,
  ) {
    return this.designBoardService.assign(req.user, id, dto);
  }

  @Roles(Role.ADMIN, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Patch('requests/:id/move')
  move(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveDesignRequestDto,
  ) {
    return this.designBoardService.move(req.user, id, dto);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Post('requests/:id/comments')
  addComment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDesignRequestCommentDto,
  ) {
    return this.designBoardService.addComment(req.user, id, dto);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Patch('requests/:id/comments/:commentId')
  editComment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: EditDesignRequestCommentDto,
  ) {
    return this.designBoardService.editComment(req.user, id, commentId, dto);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Delete('requests/:id/comments/:commentId')
  deleteComment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.designBoardService.deleteComment(req.user, id, commentId);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Delete('requests/:id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.designBoardService.deleteAttachment(req.user, id, attachmentId);
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER_MANAGER)
  @Post('requests/:id/approve')
  approve(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDesignRequestDto,
  ) {
    return this.designBoardService.approve(req.user, id, dto.approvedAttachmentIds);
  }

  // Pedido explicito del usuario, 28/oct/2026: marcar/desmarcar despues
  // de aprobar cual adjunto es "la version aprobada" por el cliente --
  // solo la comercial propietaria (o ADMIN), ver
  // DesignBoardService.markApprovedVersionAttachment(). El Jefe de
  // Diseño (DESIGNER_MANAGER) NO esta en @Roles a proposito: el permiso
  // real (ownership) lo valida el service, pero de entrada esta decision
  // nunca es suya.
  @Roles(Role.ADMIN, Role.SALES)
  @Patch('requests/:id/attachments/:attachmentId/approved-version')
  markApprovedVersionAttachment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Body() dto: MarkApprovedVersionAttachmentDto,
  ) {
    return this.designBoardService.markApprovedVersionAttachment(
      req.user,
      id,
      attachmentId,
      dto.approved,
    );
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER_MANAGER)
  @Post('requests/:id/send-to-modification')
  sendToModification(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.sendToModification(req.user, id);
  }

  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Post('requests/:id/pause')
  pause(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.pause(req.user, id);
  }

  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Post('requests/:id/resume')
  resume(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.resume(req.user, id);
  }

  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Post('requests/:id/archive')
  archive(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.archive(req.user, id);
  }

  // Pedido explicito del usuario, 30/oct/2026: desde el chat de un lead,
  // ir directo al ULTIMO boceto que se le pidio -- no una lista con todo
  // el historico. Mismos roles que listRequests(); la visibilidad (p.ej.
  // que SALES solo encuentre sus propios bocetos) la resuelve
  // getLatestRequestIdForLead() reusando visibilityWhere(). No choca con
  // 'requests/:id' (3 segmentos vs 1, mismo criterio que archive/search
  // arriba).
  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Get('requests/by-lead/:leadId/latest')
  getLatestRequestIdForLead(
    @Req() req: { user: AuthUser },
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.designBoardService.getLatestRequestIdForLead(req.user, leadId);
  }

  // Pedido explicito del usuario, 28/oct/2026: buscador de archivo
  // historico (bocetos marcados como hechos/archivados), oculto por
  // defecto -- pantalla propia en el frontend, nunca una pestaña mas del
  // tablero. No choca con el GET 'requests/:id' de arriba: ese patron
  // espera exactamente un segmento despues de 'requests', y
  // 'archive/search' son dos, asi que Nest nunca lo intenta resolver
  // como si 'archive' fuera un :id.
  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Get('requests/archive/search')
  searchArchive(
    @Req() req: { user: AuthUser },
    @Query() query: SearchArchivedDesignRequestsQueryDto,
  ) {
    return this.designBoardService.searchArchive(req.user, query);
  }

  // ADR-004 Submódulo 11: canal de tiempo real -- reusa el mismo bus SSE
  // (ChatEventsService, RabbitMQ por debajo) que ya usa /chat/events, en
  // vez de montar infraestructura nueva. A diferencia de /chat/events
  // (que sí filtra por accountId porque cada conversación pertenece a una
  // sola cuenta), el tablero de bocetos es "un solo tablero global" (ADR
  // §2): DESIGNER/DESIGNER_MANAGER/ADMIN operan sobre solicitudes de
  // cualquier cuenta (la visibilidad real la sigue aplicando cada
  // endpoint REST, esto es solo la señal de "algo cambió, refresca"), así
  // que solo SALES -- la única visibilidad ya scopeada por cuenta -- se
  // filtra por su accountId aquí.
  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Sse('events')
  streamEvents(@Req() req: { user: AuthUser }): Observable<MessageEvent> {
    if (req.user.role === Role.SALES && !req.user.accountId) {
      throw new ForbiddenException('User has no accountId');
    }

    const designBoardEvents$ = this.chatEvents.stream().pipe(
      filter((event) => event.type.startsWith('design_request.')),
      filter(
        (event) =>
          req.user.role !== Role.SALES || event.accountId === req.user.accountId,
      ),
      map((event) => ({
        type: event.type,
        id: event.id,
        data: event,
      })),
    );

    const heartbeat$ = interval(25000).pipe(
      map(() => ({
        type: 'heartbeat',
        data: { at: new Date().toISOString() },
      })),
    );

    return merge(designBoardEvents$, heartbeat$);
  }

  // Pedido explicito del usuario, 26/oct/2026: la jefa de ventas
  // (SALES_MANAGER) tambien puede ver este reporte, igual que el Jefe de
  // Diseño/Admin -- sigue sin poder gestionar el tablero (mover tarjetas,
  // asignar diseñador, etc.), eso sigue limitado a ADMIN/DESIGNER_MANAGER.
  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER, Role.SALES_MANAGER)
  @Get('reports/summary')
  getReportsSummary(
    @Req() req: { user: AuthUser },
    @Query() query: DesignBoardReportsQueryDto,
  ) {
    return this.designBoardService.getReportsSummary(req.user, query);
  }

  // Tasa de aprobacion personal del comercial (ultimos 3 meses, ver
  // DesignBoardService.getMyMonthlyApprovalRate) -- a diferencia de
  // reports/summary (solo Jefe de Diseno/Admin, agregado de todos),
  // cada SALES ve unicamente SUS propias solicitudes.
  @Roles(Role.SALES)
  @Get('reports/my-approval-rate')
  getMyMonthlyApprovalRate(@Req() req: { user: AuthUser }) {
    return this.designBoardService.getMyMonthlyApprovalRate(req.user);
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('requests/:id/attachments/:attachmentId/forward')
  forwardAttachment(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.designBoardService.forwardAttachment(
      req.user,
      id,
      attachmentId,
    );
  }
}
