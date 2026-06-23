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
    if (user.role === Role.ADMIN) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException('accountId is required for admin streams');
      }

      return accountIdFromQuery;
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
