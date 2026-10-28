import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MessageService } from './message.service';

import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  MessageConversationsQueryDto,
  MessageHistoryQueryDto,
} from './dto/message-query.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('message')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Get('lead/:leadId')
  getLeadMessages(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query() query: MessageHistoryQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.messageService.getLeadMessages({
      accountId,
      leadId,
      limit: query.limit ?? 50,
      beforeMessageId: query.before ?? null,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get('conversations')
  getConversations(
    @Query() query: MessageConversationsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.messageService.getConversations({
      accountId,
      limit: query.limit ?? 50,
      search: query.search?.trim() || null,
    });
  }

  private resolveAccountId(
    user: AuthUser,
    accountIdFromQuery?: string,
  ): string {
    // SUPPORT ve todo lo que ve ADMIN (herencia de roles en el backend).
    if (user.role === Role.ADMIN || user.role === Role.SUPPORT) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException('accountId is required for admin queries');
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
          'You cannot access another account messages',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
