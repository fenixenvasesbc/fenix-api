import { Module } from '@nestjs/common';
import { LabelMessageRulesController } from './label-message-rules.controller';
import { LabelMessageRulesService } from './label-message-rules.service';

@Module({
  controllers: [LabelMessageRulesController],
  providers: [LabelMessageRulesService],
  exports: [LabelMessageRulesService],
})
export class LabelMessageRulesModule {}
