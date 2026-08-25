import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsExportController } from './leads-export.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadsExportController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
