import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { FirstMessageMetricsDto } from './dto/first-message-metrics.dto';
import { AccountFirstMessageMetricsDto } from './dto/first-message-metrics.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /dashboard/metrics/first-message-responses
   *
   * Query params:
   * - from
   * - to
   * - groupByAccount (optional)
   *
   * Comportamiento:
   * - ADMIN → consulta global
   * - ADMIN + groupByAccount=true → agrupa por cuenta y template
   * - SALES → solo su cuenta
   */
  @Get('metrics/first-message-responses')
  getFirstMessageResponses(
    @Query() dto: FirstMessageMetricsDto,
    @Req() req: any,
  ) {
    return this.dashboardService.getFirstMessageResponses(dto, req.user);
  }

  /**
   * POST /dashboard/metrics/account/first-message-responses
   *
   * Body:
   * {
   *   accountId: string,
   *   from: string,
   *   to: string
   * }
   *
   * Solo ADMIN puede usarlo.
   * Permite consultar métricas de una cuenta específica
   * sin exponer accountId en la URL.
   */
  @Post('metrics/account/first-message-responses')
  getAccountFirstMessageResponses(
    @Body() dto: AccountFirstMessageMetricsDto,
    @Req() req: any,
  ) {
    return this.dashboardService.getAccountFirstMessageResponses(dto, req.user);
  }
}
