import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GlobalTemplatesService } from './global-templates.service';
import {
  AddGlobalTemplateAccountDto,
  CreateGlobalTemplateDto,
} from './dto/global-template.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

// Gestion global de plantillas de WhatsApp: se crea una vez y se replica
// automaticamente en el WABA de cada comercial (Account) activo. Solo
// ADMIN y SALES_MANAGER pueden gestionarlas.
@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SALES_MANAGER)
export class GlobalTemplatesController {
  constructor(private readonly globalTemplatesService: GlobalTemplatesService) {}

  @Post()
  create(@Body() dto: CreateGlobalTemplateDto, @Req() req: { user: AuthUser }) {
    return this.globalTemplatesService.create(req.user.userId, dto);
  }

  @Get()
  list() {
    return this.globalTemplatesService.list();
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.globalTemplatesService.getById(id);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.globalTemplatesService.remove(id);
  }

  @Post(':id/accounts')
  addAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddGlobalTemplateAccountDto,
  ) {
    return this.globalTemplatesService.addAccount(id, dto.accountId);
  }

  @Delete(':id/accounts/:accountTemplateId')
  removeAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('accountTemplateId', new ParseUUIDPipe()) accountTemplateId: string,
  ) {
    return this.globalTemplatesService.removeAccount(id, accountTemplateId);
  }
}
