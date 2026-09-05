import { Module } from '@nestjs/common';
import { LeadLabelDefinitionsController } from './lead-label-definitions.controller';
import { LeadLabelDefinitionsService } from './lead-label-definitions.service';

@Module({
  controllers: [LeadLabelDefinitionsController],
  providers: [LeadLabelDefinitionsService],
  exports: [LeadLabelDefinitionsService],
})
export class LeadLabelDefinitionsModule {}
