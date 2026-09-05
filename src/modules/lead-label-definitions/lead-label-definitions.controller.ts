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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateLeadLabelDefinitionDto,
  UpdateLeadLabelDefinitionDto,
} from './dto/lead-label-definition.dto';
import { LeadLabelDefinitionsService } from './lead-label-definitions.service';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

// Config de labels de lead (antes enum LeadLabel) desde la UI. Leer el
// catalogo (list) lo puede hacer cualquiera que trabaje con leads (ADMIN,
// SALES, SALES_MANAGER), ya que leads/mensajes necesitan la lista para sus
// selectores de label. Crear/editar/borrar labels (y su umbral de alerta)
// queda solo para ADMIN y SALES_MANAGER, igual que el resto de pantallas de
// Configuracion.
@Controller('lead-label-definitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadLabelDefinitionsController {
  constructor(
    private readonly leadLabelDefinitionsService: LeadLabelDefinitionsService,
  ) {}

  @Roles(Role.ADMIN, Role.SALES, Role.SALES_MANAGER)
  @Get()
  async list(
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);
    const data =
      await this.leadLabelDefinitionsService.listByAccount(accountId);

    return { accountId, data };
  }

  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Post()
  async create(
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Body() body: CreateLeadLabelDefinitionDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadLabelDefinitionsService.create({
      accountId,
      name: body.name,
      color: body.color,
      alertThresholdDays: body.alertThresholdDays,
      sortOrder: body.sortOrder,
    });
  }

  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Body() body: UpdateLeadLabelDefinitionDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadLabelDefinitionsService.update({
      accountId,
      id,
      name: body.name,
      color: body.color,
      alertThresholdDays: body.alertThresholdDays,
      active: body.active,
      sortOrder: body.sortOrder,
    });
  }

  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.leadLabelDefinitionsService.remove(accountId, id);
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

    if (user.role === Role.SALES || user.role === Role.SALES_MANAGER) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      if (accountIdFromQuery && accountIdFromQuery !== user.accountId) {
        throw new ForbiddenException('You cannot access another account labels');
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
