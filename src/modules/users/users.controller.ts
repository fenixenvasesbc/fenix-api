import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('sales')
  getSales() {
    return this.usersService.getSales();
  }

  // ==========================================
  // Modulo de administracion de usuarios
  // (Configuracion -> Usuarios). ADMIN gestiona cualquier
  // rol; SALES_MANAGER solo puede crear/editar/(des)activar
  // usuarios de rol SALES (filtrado y validado en el service).
  // ==========================================

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Get()
  listUsers(@Query() query: ListUsersQueryDto, @Req() req: { user: AuthUser }) {
    return this.usersService.listUsers(req.user, {
      role: query.role,
      search: query.search?.trim() || undefined,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Get(':id')
  getUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.getUserSafe(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Post()
  createUser(@Body() dto: CreateUserDto, @Req() req: { user: AuthUser }) {
    return this.usersService.adminCreateUser(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Patch(':id')
  updateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.usersService.adminUpdateUser(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Patch(':id/deactivate')
  deactivateUser(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: { user: AuthUser }) {
    return this.usersService.setUserActive(req.user, id, false);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Patch(':id/activate')
  activateUser(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: { user: AuthUser }) {
    return this.usersService.setUserActive(req.user, id, true);
  }
}
