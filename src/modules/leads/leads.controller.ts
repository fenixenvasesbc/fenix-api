import {
  Body,
  Controller,
  Delete,
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
import { ModuleRef } from '@nestjs/core';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  DueRepetitionRemindersQueryDto,
  ListLeadsQueryDto,
  RemoveLeadLabelDto,
  SetLeadLabelDto,
  UpdateLeadNameDto,
} from './dto/lead.dto';
import { LeadsService } from './leads.service';
import { SYSTEM_LABEL_CODES } from '../../common/constants/lead-labels';
// DesignBoardService se resuelve en runtime via ModuleRef (ver
// getDesignBoardService() mas abajo) en vez de que LeadsModule importe
// DesignBoardModule en su @Module({ imports: [...] }) -- eso SI crearia un
// ciclo, porque DesignBoardModule ya importa LeadsModule para poder llamar
// setLabel(). Un import de la clase (valor de TS/JS, no del @Module de
// Nest) es seguro: no participa del grafo de dependencias de Nest.
import { DesignBoardService } from '../design-board/design-board.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly moduleRef: ModuleRef,
  ) {}

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
      labelStaleDays: query.labelStaleDays,
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

    // ADR-004 Submódulo 2: BOCETO_APROBADO mueve automáticamente la
    // solicitud de boceto correspondiente a "Aprobados", o bloquea la
    // etiqueta (lanza) si no hay ninguna esperando aprobación. Se corre
    // ANTES de aplicar la etiqueta en sí, para que el bloqueo impida que
    // llegue a guardarse.
    if (body.label === SYSTEM_LABEL_CODES.BOCETO_APROBADO) {
      await this.getDesignBoardService().approveByLabel(
        accountId,
        leadId,
        req.user.userId,
      );
    }

    return this.leadsService.setLabel({
      accountId,
      leadId,
      label: body.label,
      reminderDays: body.reminderDays,
      changedByUserId: req.user.userId,
    });
  }

  private getDesignBoardService(): DesignBoardService {
    return this.moduleRef.get(DesignBoardService, { strict: false });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Patch(':leadId/name')
  async updateName(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Body() body: UpdateLeadNameDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadsService.updateManualName({
      accountId,
      leadId,
      name: body.name,
      changedByUserId: req.user.userId,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Delete(':leadId/labels/:label')
  async removeLabel(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Param('label') label: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Body() body: RemoveLeadLabelDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadsService.removeLabel({
      accountId,
      leadId,
      label,
      changedByUserId: req.user.userId,
      reason: body.reason ?? null,
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
  @Get(':leadId/labels')
  async getLabels(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);
    const labels = await this.leadsService.getLabels(accountId, leadId);

    return { data: labels };
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
    // SUPPORT ve todo lo que ve ADMIN (herencia de roles en el backend).
    if (user.role === Role.ADMIN || user.role === Role.SUPPORT) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException('accountId is required for admin queries');
      }

      return accountIdFromQuery;
    }

    // SALES_MANAGER puede ver/editar los leads y etiquetas de CUALQUIER
    // comercial cuando la UI le pasa un accountId explicito (selector de
    // cuenta en la pestana Leads, igual que ADMIN). Pero tambien usa estos
    // mismos endpoints desde la bandeja de mensajes (agregar/quitar
    // etiqueta al chatear), donde NO hay selector de cuenta y nunca se
    // manda accountId -- ahi debe caer a su propia cuenta, igual que
    // SALES, para no romper ese flujo.
    if (user.role === Role.SALES_MANAGER) {
      if (accountIdFromQuery) {
        return accountIdFromQuery;
      }

      if (user.accountId) {
        return user.accountId;
      }

      throw new ForbiddenException('accountId is required for admin queries');
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
