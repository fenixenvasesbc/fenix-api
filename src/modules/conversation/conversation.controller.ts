import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConversationService } from './conversation.service';
import {
  ConversationAccountQueryDto,
  ConversationListQueryDto,
} from './dto/conversation-query.dto';
import { ChatEventsService } from '../chat-events/chat-events.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Get()
  async listConversations(
    @Query() query: ConversationListQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    const conversations = await this.conversationService.listByAccount({
      accountId,
      limit: query.limit ?? 50,
      search: query.search?.trim() || null,
      onlyOpen: query.onlyOpen ?? false,
      onlyPending: query.onlyPending ?? false,
    });

    return { data: conversations };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get(':leadId')
  async getConversation(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query() query: ConversationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);
    const conversation = await this.conversationService.getByLead(
      accountId,
      leadId,
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.chatEvents.publish({
      type: 'conversation.read',
      accountId,
      leadId,
      conversationId: conversation.id,
      payload: {
        unreadCount: conversation.unreadCount,
        requiresAttention: conversation.requiresAttention,
      },
    });

    return { data: conversation };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post(':leadId/read')
  async markAsRead(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query() query: ConversationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);
    const conversation = await this.conversationService.markAsRead({
      accountId,
      leadId,
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return { data: conversation };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post(':leadId/close')
  async closeConversation(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query() query: ConversationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    const conversation = await this.conversationService.close({
      accountId,
      leadId,
    });

    await this.chatEvents.publish({
      type: 'conversation.closed',
      accountId,
      leadId,
      conversationId: conversation.id,
      payload: {
        status: conversation.status,
        closedAt: conversation.closedAt?.toISOString() ?? null,
      },
    });

    return { data: conversation };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post(':leadId/reopen')
  async reopenConversation(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query() query: ConversationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    const conversation = await this.conversationService.reopen({
      accountId,
      leadId,
    });

    await this.chatEvents.publish({
      type: 'conversation.reopened',
      accountId,
      leadId,
      conversationId: conversation.id,
      payload: {
        status: conversation.status,
        isCustomerWindowOpen: conversation.isCustomerWindowOpen,
      },
    });

    return { data: conversation };
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
          'You cannot access another account conversations',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
