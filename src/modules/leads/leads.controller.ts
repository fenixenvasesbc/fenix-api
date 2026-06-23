import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  DueRepetitionRemindersQueryDto,
  ListLeadsQueryDto,
  SetLeadLabelDto,
} from './dto/lead.dto';
import { LeadsService } from './leads.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Get()
  async listLeads(
    @Query() query: ListLeadsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    const leads = await this.leadsService.listByAccount({
      accountId,
      label: query.label,
      search: query.search?.trim() || null,
      limit: query.limit ?? 50,
      beforeLeadId: query.before ?? null,
      labelChangedOrder: query.labelChangedOrder ?? 'desc',
    });

    return { accountId, ...leads };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Patch(':leadId/label')
  async setLabel(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Body() body: SetLeadLabelDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadsService.setLabel({
      accountId,
      leadId,
      label: body.label,
      reminderDays: body.reminderDays,
      changedByUserId: req.user.userId,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get(':leadId/label-history')
  async getLabelHistory(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);
    const history = await this.leadsService.getHistory(accountId, leadId);

    return { data: history };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get('repetition-reminders/due')
  async listDueRepetitionReminders(
    @Query() query: DueRepetitionRemindersQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);
    const reminders = await this.leadsService.listDueRepetitionReminders(
      accountId,
      query.limit ?? 100,
    );

    return { accountId, data: reminders };
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('repetition-reminders/:reminderId/sent')
  async markRepetitionReminderSent(
    @Param('reminderId', new ParseUUIDPipe()) reminderId: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);
    const reminder = await this.leadsService.markRepetitionReminderSent(
      accountId,
      reminderId,
    );

    return { data: reminder };
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
        throw new ForbiddenException('You cannot access another account leads');
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
