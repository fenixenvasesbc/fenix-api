import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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

// Config de labels de lead (antes enum LeadLabel, luego una copia por
// cuenta) desde la UI. Es un catalogo GLOBAL: una sola definicion compartida
// por todas las cuentas del sistema. Leer el catalogo (list) lo puede hacer
// cualquiera que trabaje con leads (ADMIN, SALES, SALES_MANAGER), ya que
// leads/mensajes necesitan la lista para sus selectores de label.
// Crear/editar/borrar labels (y su umbral de alerta) queda solo para ADMIN y
// SALES_MANAGER, igual que el resto de pantallas de Configuracion.
@Controller('lead-label-definitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadLabelDefinitionsController {
  constructor(
    private readonly leadLabelDefinitionsService: LeadLabelDefinitionsService,
  ) {}

  @Roles(Role.ADMIN, Role.SALES, Role.SALES_MANAGER)
  @Get()
  async list() {
    const data = await this.leadLabelDefinitionsService.list();

    return { data };
  }

  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Post()
  async create(@Body() body: CreateLeadLabelDefinitionDto) {
    return this.leadLabelDefinitionsService.create({
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
    @Body() body: UpdateLeadLabelDefinitionDto,
  ) {
    return this.leadLabelDefinitionsService.update({
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
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.leadLabelDefinitionsService.remove(id);
  }
}
