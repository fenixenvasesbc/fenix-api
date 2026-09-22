import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CampaignTemplateSyncService } from './campaign-template-sync.service';
import { SyncCampaignTemplatesDto } from './dto/sync-campaign-templates.dto';

// Sync a demanda de CampaignDefinition/AccountCampaignTemplate (Repeticion,
// Reenganche) contra YCloud, por cuenta -- ver ADR-003. Solo ADMIN y
// SALES_MANAGER, igual que la gestion de plantillas globales.
@Controller('campaign-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SALES_MANAGER)
export class CampaignTemplatesController {
  constructor(
    private readonly campaignTemplateSyncService: CampaignTemplateSyncService,
  ) {}

  @Post('accounts/:accountId/sync')
  syncAccount(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Body() dto: SyncCampaignTemplatesDto,
  ) {
    return this.campaignTemplateSyncService.syncAccount(accountId, {
      preferLanguage: dto.preferLanguage,
    });
  }
}
