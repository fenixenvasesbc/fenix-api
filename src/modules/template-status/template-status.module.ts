import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TemplateStatusService } from './template-status.service';

@Module({
  imports: [PrismaModule],
  providers: [TemplateStatusService],
  exports: [TemplateStatusService],
})
export class TemplateStatusModule {}
