import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import {
  MarkLabelStaleNotificationsReadDto,
  NotificationAccountQueryDto,
  NotificationsQueryDto,
} from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // DESIGNER/DESIGNER_MANAGER no tienen accountId (su login queda limitado
  // solo al tablero de bocetos, ver ADR-004 §12) -- para ellos las
  // notificaciones se resuelven por recipientUserId (el propio usuario),
  // no por cuenta comercial. Es este metodo el que decide cual camino usar.
  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Get()
  async list(
    @Query() query: NotificationsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    if (this.isDesignBoardOnly(req.user.role)) {
      return this.notificationsService.listByRecipient({
        recipientUserId: req.user.userId,
        status: query.status ?? 'UNREAD',
        limit: query.limit,
      });
    }

    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.notificationsService.listByAccount({
      accountId,
      status: query.status ?? 'UNREAD',
      limit: query.limit,
    });
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Post(':notificationId/read')
  async markAsRead(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @Query() query: NotificationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    if (this.isDesignBoardOnly(req.user.role)) {
      const notification = await this.notificationsService.markAsReadForRecipient(
        req.user.userId,
        notificationId,
      );

      return { data: notification };
    }

    const accountId = this.resolveAccountId(req.user, query.accountId);
    const notification = await this.notificationsService.markAsRead(
      accountId,
      notificationId,
    );

    return { data: notification };
  }

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Post('read-all')
  async markAllAsRead(
    @Query() query: NotificationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    if (this.isDesignBoardOnly(req.user.role)) {
      return this.notificationsService.markAllAsReadForRecipient(req.user.userId);
    }

    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.notificationsService.markAllAsRead(accountId);
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('read-label-stale')
  async markLabelStaleAsRead(
    @Body() body: MarkLabelStaleNotificationsReadDto,
    @Query() query: NotificationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.notificationsService.markLabelStaleAsRead(
      accountId,
      body.label,
    );
  }

  private isDesignBoardOnly(role: Role): boolean {
    return role === Role.DESIGNER || role === Role.DESIGNER_MANAGER;
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

    if (user.role === Role.SALES || user.role === Role.SALES_MANAGER) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      if (accountIdFromQuery && accountIdFromQuery !== user.accountId) {
        throw new ForbiddenException(
          'You cannot access another account notifications',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
