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
  CreateDesignRequestCategoryDto,
  UpdateDesignRequestCategoryDto,
} from './dto/design-request-category.dto';
import { DesignRequestCategoriesService } from './design-request-categories.service';

// Categorias de boceto (Configuracion > Categorias) -- catalogo GLOBAL,
// APARTE de las labels de lead (ver lead-label-definitions). Leer el
// catalogo lo puede hacer cualquier rol del modulo de bocetos (lo
// necesitan para los selectores de "Crear boceto" y el detalle de la
// solicitud); crear/editar/borrar queda solo para ADMIN (pedido explicito
// del usuario, 27/oct/2026 -- a diferencia de las labels de lead, aqui NO
// se le da acceso a DESIGNER_MANAGER para no romper el aislamiento del
// ADR-004 que lo restringe unicamente al tablero de bocetos).
@Controller('design-request-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DesignRequestCategoriesController {
  constructor(
    private readonly designRequestCategoriesService: DesignRequestCategoriesService,
  ) {}

  @Roles(Role.ADMIN, Role.SALES, Role.SALES_MANAGER, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Get()
  async list() {
    const data = await this.designRequestCategoriesService.list();

    return { data };
  }

  @Roles(Role.ADMIN)
  @Post()
  async create(@Body() body: CreateDesignRequestCategoryDto) {
    return this.designRequestCategoriesService.create({
      name: body.name,
      color: body.color,
      sortOrder: body.sortOrder,
    });
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateDesignRequestCategoryDto,
  ) {
    return this.designRequestCategoriesService.update({
      id,
      name: body.name,
      color: body.color,
      active: body.active,
      sortOrder: body.sortOrder,
    });
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.designRequestCategoriesService.remove(id);
  }
}
