import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CampaignTemplatesModule } from '../campaign-templates/campaign-templates.module';
import { TemplateStatusService } from './template-status.service';

@Module({
  imports: [PrismaModule, CampaignTemplatesModule],
  providers: [TemplateStatusService],
  exports: [TemplateStatusService],
})
export class TemplateStatusModule {}
