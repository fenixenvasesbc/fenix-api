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
    if (user.role === Role.ADMIN) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException('accountId is required for admin queries');
      }

      return accountIdFromQuery;
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
