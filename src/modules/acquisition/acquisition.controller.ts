import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseEntityIdPipe } from './parse-entity-id.pipe';
import { AcquisitionCatalogService } from './acquisition-catalog.service';
import { AcquisitionReportService } from './acquisition-report.service';
import { AcquisitionSpendService } from './acquisition-spend.service';
import {
  AcquisitionReportQueryDto,
  CreateInvestmentFamilyDto,
  CreateAcquisitionTemplateDto,
  UpdateInvestmentFamilyDto,
  UpdateAcquisitionTemplateDto,
  SaveSpendFormDto,
  SpendFormQueryDto,
  UpdateAcquisitionSettingsDto,
} from './dto/acquisition.dto';

/**
 * ADR-007: atribucion de captacion y ROI semanal de campañas.
 *
 * - Catalogo (familias y equivalencias plantilla->familia): SOLO SUPPORT
 *   (@Roles(Role.SUPPORT) sin ADMIN: la herencia SUPPORT->ADMIN es
 *   unidireccional, mismo criterio que LabelMessageRule, ADR-002).
 * - Reportes, inversion diaria y objetivos: ADMIN (y SUPPORT por herencia), que son
 *   los roles con acceso al Dashboard en la SPA.
 */
@Controller('acquisition')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcquisitionController {
  constructor(
    private readonly catalog: AcquisitionCatalogService,
    private readonly reports: AcquisitionReportService,
    private readonly spend: AcquisitionSpendService,
  ) {}

  // ---- Catalogo -----------------------------------------------------------

  // Lectura de familias: tambien ADMIN (el dashboard las necesita).
  @Roles(Role.ADMIN)
  @Get('families')
  async listFamilies() {
    return { data: await this.catalog.listFamilies() };
  }

  @Roles(Role.SUPPORT)
  @Post('families')
  createFamily(@Body() body: CreateInvestmentFamilyDto) {
    return this.catalog.createFamily(body);
  }

  @Roles(Role.SUPPORT)
  @Patch('families/:id')
  updateFamily(
    @Param('id', new ParseEntityIdPipe()) id: string,
    @Body() body: UpdateInvestmentFamilyDto,
  ) {
    return this.catalog.updateFamily(id, body);
  }

  @Roles(Role.SUPPORT)
  @Get('templates')
  async listTemplates() {
    return { data: await this.catalog.listTemplates() };
  }

  @Roles(Role.SUPPORT)
  @Post('templates')
  createTemplate(@Body() body: CreateAcquisitionTemplateDto) {
    return this.catalog.createTemplate(body);
  }

  @Roles(Role.SUPPORT)
  @Patch('templates/:id')
  updateTemplate(
    @Param('id', new ParseEntityIdPipe()) id: string,
    @Body() body: UpdateAcquisitionTemplateDto,
  ) {
    return this.catalog.updateTemplate(id, body);
  }

  @Roles(Role.SUPPORT)
  @Delete('templates/:id')
  deleteTemplate(@Param('id', new ParseEntityIdPipe()) id: string) {
    return this.catalog.deleteTemplate(id);
  }

  // ---- Inversion diaria y objetivo €/mensaje ---------------------------------

  /** Valores vigentes en `date` (por defecto hoy) para precargar el formulario. */
  @Roles(Role.ADMIN)
  @Get('spend')
  getSpend(@Query() query: SpendFormQueryDto) {
    return this.spend.getForm(query.date);
  }

  /** Guarda desde `date` solo los importes/objetivos que cambian. */
  @Roles(Role.ADMIN)
  @Put('spend')
  saveSpend(@Req() req: { user: { userId: string } }, @Body() body: SaveSpendFormDto) {
    return this.spend.saveForm(body.date, body.items, req.user.userId);
  }

  // ---- Ajustes (etiqueta "Presupuesto enviado") ------------------------------

  @Roles(Role.ADMIN)
  @Get('settings')
  getSettings() {
    return this.spend.getSettings();
  }

  @Roles(Role.SUPPORT)
  @Patch('settings')
  updateSettings(@Req() req: { user: { userId: string } }, @Body() body: UpdateAcquisitionSettingsDto) {
    return this.spend.updateSettings(body, req.user.userId);
  }

  // ---- Reportes --------------------------------------------------------------

  /** granularity=week (martes-lunes, por defecto) o day (dias de envio). */
  @Roles(Role.ADMIN)
  @Get('report')
  report(@Query() query: AcquisitionReportQueryDto) {
    return this.reports.getReport(query);
  }

  @Roles(Role.ADMIN)
  @Get('report/conversion-lag')
  conversionLag(@Query() query: AcquisitionReportQueryDto) {
    return this.reports.getConversionLag(query);
  }
}
