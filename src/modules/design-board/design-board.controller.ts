import {
  Body,
  Controller,
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
  AssignDesignRequestDto,
  CreateDesignRequestDto,
  DesignBoardReportsQueryDto,
  ListDesignRequestsQueryDto,
  MoveDesignRequestDto,
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

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER_MANAGER)
  @Post('requests/:id/approve')
  approve(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.designBoardService.approve(req.user, id);
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

  @Roles(Role.ADMIN, Role.DESIGNER_MANAGER)
  @Get('reports/summary')
  getReportsSummary(
    @Req() req: { user: AuthUser },
    @Query() query: DesignBoardReportsQueryDto,
  ) {
    return this.designBoardService.getReportsSummary(req.user, query);
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
