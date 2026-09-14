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
import { CurrentUser } from '../auth/decorators/current.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateLabelMessageRuleDto,
  UpdateLabelMessageRuleDto,
} from './dto/label-message-rule.dto';
import { LabelMessageRulesService } from './label-message-rules.service';

// Configuracion de LabelMessageRule (ADR-002): "si un lead lleva N dias en
// esta etiqueta, mandale esta plantilla". Solo SUPPORT puede ver/administrar
// esta pantalla -- a proposito, ADMIN NO esta en la lista de @Roles aqui.
// SUPPORT si hereda el resto de los permisos de ADMIN (ver ROLE_INHERITANCE
// en RolesGuard), esto es la unica funcionalidad exclusiva del rol nuevo.
@Controller('label-message-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPPORT)
export class LabelMessageRulesController {
  constructor(
    private readonly labelMessageRulesService: LabelMessageRulesService,
  ) {}

  @Get()
  async list() {
    const data = await this.labelMessageRulesService.list();

    return { data };
  }

  @Post()
  async create(
    @Body() body: CreateLabelMessageRuleDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.labelMessageRulesService.create({
      name: body.name,
      labelCode: body.labelCode,
      triggerAfterDays: body.triggerAfterDays,
      templateName: body.templateName,
      createdByUserId: user.userId,
    });
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLabelMessageRuleDto,
  ) {
    return this.labelMessageRulesService.update({
      id,
      name: body.name,
      labelCode: body.labelCode,
      triggerAfterDays: body.triggerAfterDays,
      templateName: body.templateName,
      active: body.active,
    });
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.labelMessageRulesService.remove(id);
  }
}
