import {
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

  @Roles(Role.ADMIN, Role.SALES)
  @Get()
  async list(
    @Query() query: NotificationsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.notificationsService.listByAccount({
      accountId,
      status: query.status ?? 'UNREAD',
      limit: query.limit,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post(':notificationId/read')
  async markAsRead(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @Query() query: NotificationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);
    const notification = await this.notificationsService.markAsRead(
      accountId,
      notificationId,
    );

    return { data: notification };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('read-all')
  async markAllAsRead(
    @Query() query: NotificationAccountQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.notificationsService.markAllAsRead(accountId);
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
          'You cannot access another account notifications',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
