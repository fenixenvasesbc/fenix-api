import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { AcquisitionCatalogService } from './acquisition-catalog.service';
import { AcquisitionReportService } from './acquisition-report.service';
import {
  AcquisitionReportQueryDto,
  CreateInvestmentFamilyDto,
  CreateLandingDto,
  UpdateInvestmentFamilyDto,
  UpdateLandingDto,
  UpsertWeeklySpendDto,
  WeeklySpendQueryDto,
} from './dto/acquisition.dto';

/**
 * ADR-007: atribucion de captacion y ROI semanal de campañas.
 *
 * - Catalogo (familias y equivalencias landing->familia): SOLO SUPPORT
 *   (@Roles(Role.SUPPORT) sin ADMIN: la herencia SUPPORT->ADMIN es
 *   unidireccional, mismo criterio que LabelMessageRule, ADR-002).
 * - Reportes e inversion semanal: ADMIN (y SUPPORT por herencia), que son
 *   los roles con acceso al Dashboard en la SPA.
 */
@Controller('acquisition')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcquisitionController {
  constructor(
    private readonly catalog: AcquisitionCatalogService,
    private readonly reports: AcquisitionReportService,
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateInvestmentFamilyDto,
  ) {
    return this.catalog.updateFamily(id, body);
  }

  @Roles(Role.SUPPORT)
  @Get('landings')
  async listLandings() {
    return { data: await this.catalog.listLandings() };
  }

  @Roles(Role.SUPPORT)
  @Post('landings')
  createLanding(@Body() body: CreateLandingDto) {
    return this.catalog.createLanding(body);
  }

  @Roles(Role.SUPPORT)
  @Patch('landings/:id')
  updateLanding(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLandingDto,
  ) {
    return this.catalog.updateLanding(id, body);
  }

  @Roles(Role.SUPPORT)
  @Delete('landings/:id')
  deleteLanding(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.deleteLanding(id);
  }

  // ---- Inversion semanal -----------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('spend')
  getSpend(@Query() query: WeeklySpendQueryDto) {
    return this.reports.getWeeklySpend(query.weekStart);
  }

  @Roles(Role.ADMIN)
  @Put('spend')
  upsertSpend(
    @Req() req: { user: { userId: string } },
    @Body() body: UpsertWeeklySpendDto,
  ) {
    return this.reports.upsertWeeklySpend(body.weekStart, body.items, req.user.userId);
  }

  // ---- Reportes --------------------------------------------------------------

  @Roles(Role.ADMIN)
  @Get('report/weekly')
  weeklyReport(@Query() query: AcquisitionReportQueryDto) {
    return this.reports.getWeeklyReport(query);
  }

  @Roles(Role.ADMIN)
  @Get('report/conversion-lag')
  conversionLag(@Query() query: AcquisitionReportQueryDto) {
    return this.reports.getConversionLag(query);
  }
}
