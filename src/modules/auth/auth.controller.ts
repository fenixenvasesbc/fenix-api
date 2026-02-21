import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { RegisterSalesDto } from './dto/register-sales.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Público
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // Protegido: SOLO ADMIN puede crear ADMIN
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admins')
  createAdmin(@Body() dto: RegisterAdminDto) {
    return this.auth.createAdmin(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('sales')
  createSales(@Body() dto: RegisterSalesDto) {
    return this.auth.createSales(dto.email, dto.password);
  }

  // Protegido: útil para validar token
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me() {
    return { ok: true };
  }
}