import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OutboundService } from './outbound.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

type SendTemplateDto = {
  accountId?: string;
  leadId: string;
  templateName: string;
  languageCode?: string | null;
};

type SendTextDto = {
  accountId?: string;
  leadId: string;
  text: string;
};

@Controller('outbound')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OutboundController {
  constructor(private readonly outboundMessageService: OutboundService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Post('template')
  sendTemplate(
    @Body() body: SendTemplateDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.sendTemplateMessage({
      accountId,
      leadId: body.leadId,
      templateName: body.templateName,
      languageCode: body.languageCode ?? null,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('text')
  sendText(@Body() body: SendTextDto, @Req() req: { user: AuthUser }) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.sendTextMessage({
      accountId,
      leadId: body.leadId,
      text: body.text,
    });
  }

  private resolveAccountId(user: AuthUser, accountIdFromBody?: string): string {
    if (user.role === Role.ADMIN) {
      if (!accountIdFromBody) {
        throw new ForbiddenException(
          'accountId is required for admin requests',
        );
      }

      return accountIdFromBody;
    }

    if (user.role === Role.SALES) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      if (accountIdFromBody && accountIdFromBody !== user.accountId) {
        throw new ForbiddenException(
          'You cannot send messages from another account',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
