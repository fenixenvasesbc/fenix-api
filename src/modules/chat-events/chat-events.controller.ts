import {
  Controller,
  ForbiddenException,
  MessageEvent,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { interval, map, merge, Observable, filter } from 'rxjs';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChatEventsService } from './chat-events.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatEventsController {
  constructor(private readonly chatEvents: ChatEventsService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Sse('events')
  streamEvents(
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ): Observable<MessageEvent> {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    const chatEvents$ = this.chatEvents.stream().pipe(
      filter((event) => event.accountId === accountId),
      map((event) => ({
        type: event.type,
        id: event.id,
        data: event,
      })),
    );

    const heartbeat$ = interval(25000).pipe(
      map(() => ({
        type: 'heartbeat',
        data: {
          accountId,
          at: new Date().toISOString(),
        },
      })),
    );

    return merge(chatEvents$, heartbeat$);
  }

  private resolveAccountId(
    user: AuthUser,
    accountIdFromQuery?: string,
  ): string {
    // SUPPORT ve todo lo que ve ADMIN (herencia de roles en el backend).
    if (user.role === Role.ADMIN || user.role === Role.SUPPORT) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException('accountId is required for admin streams');
      }

      return accountIdFromQuery;
    }

    // Pedido explicito del usuario, 28/oct/2026: SALES_MANAGER puede ver
    // la bandeja de mensajes de CUALQUIER comercial de la organizacion
    // (mismo alcance que ADMIN), cuando la UI le pasa un accountId
    // explicito. Si no manda accountId, cae a su propia cuenta -- mismo
    // patron que conversation.controller.ts / leads.controller.ts.
    if (user.role === Role.SALES_MANAGER) {
      if (accountIdFromQuery) {
        return accountIdFromQuery;
      }

      if (user.accountId) {
        return user.accountId;
      }

      throw new ForbiddenException('User has no accountId');
    }

    if (user.role === Role.SALES) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      if (accountIdFromQuery && accountIdFromQuery !== user.accountId) {
        throw new ForbiddenException(
          'You cannot subscribe to another account events',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
