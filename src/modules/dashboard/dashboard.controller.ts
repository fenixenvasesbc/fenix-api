import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { FirstMessageMetricsDto } from './dto/first-message-metrics.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) {}
    @Get('metrics/first-message-responses')
        getFirstMessageResponses(@Query() dto: FirstMessageMetricsDto, @Req() req: any) {
        return this.dashboardService.getFirstMessageResponses(dto, req.user);
    }
}
