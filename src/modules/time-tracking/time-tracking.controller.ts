import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EmployeesService } from './employees.service';
import { TimeEntriesService } from './time-entries.service';
import { TimeTrackingPurgeService } from './time-tracking-purge.service';
import { TimeTrackingRatesService } from './time-tracking-rates.service';
import { TimeTrackingSummaryService } from './time-tracking-summary.service';
import {
  CreateEmployeeDto,
  EmployeeIdParamDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { ClockDto, ListEntriesQueryDto } from './dto/time-entry.dto';
import { UpdateRatesDto } from './dto/rates.dto';
import { TimeTrackingSummaryQueryDto } from './dto/summary.dto';
import { PurgeTimeTrackingDto } from './dto/purge.dto';

// Módulo completo: ADMIN, FACTORY y FACTORY_MANAGER pueden fichar y consultar empleados.
const MODULE_ROLES = [Role.ADMIN, Role.FACTORY, Role.FACTORY_MANAGER];
// Gestión (CRUD empleados, tarifas, resúmenes): solo ADMIN y FACTORY_MANAGER.
const MANAGEMENT_ROLES = [Role.ADMIN, Role.FACTORY_MANAGER];

@Controller('time-tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...MODULE_ROLES)
export class TimeTrackingController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly entries: TimeEntriesService,
    private readonly rates: TimeTrackingRatesService,
    private readonly summary: TimeTrackingSummaryService,
    private readonly purgeService: TimeTrackingPurgeService,
  ) {}

  @Get('employees')
  listEmployees(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('employees')
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch('employees/:id')
  updateEmployee(
    @Param() params: EmployeeIdParamDto,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(params.id, dto);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete('employees/:id')
  removeEmployee(@Param() params: EmployeeIdParamDto) {
    return this.employees.remove(params.id);
  }

  @Get('employees/:id/entries')
  listEntries(
    @Param() params: EmployeeIdParamDto,
    @Query() query: ListEntriesQueryDto,
  ) {
    return this.entries.listForEmployee(params.id, query.from, query.to);
  }

  @Post('clock')
  clock(@Body() dto: ClockDto, @CurrentUser() user: { userId: string }) {
    return this.entries.clock(dto.employeeId, user.userId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Get('rates')
  getRates() {
    return this.rates.getRates();
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch('rates')
  updateRates(
    @Body() dto: UpdateRatesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.rates.updateRates(dto, user.userId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Get('summary')
  getSummary(@Query() query: TimeTrackingSummaryQueryDto) {
    return this.summary.summarize(query);
  }

  // Solo ADMIN: usado por el script de escritorio para el borrado total del módulo.
  @Roles(Role.ADMIN)
  @Get('purge/preview')
  purgePreview() {
    return this.purgeService.preview();
  }

  @Roles(Role.ADMIN)
  @Delete('purge')
  purge(@Body() dto: PurgeTimeTrackingDto) {
    return this.purgeService.purge(dto.confirmationPhrase);
  }
}
