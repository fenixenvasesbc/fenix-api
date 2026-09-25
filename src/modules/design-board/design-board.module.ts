import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { OutboundModule } from '../outbound/outbound.module';
import { DesignBoardController } from './design-board.controller';
import { DesignBoardService } from './design-board.service';

@Module({
  imports: [LeadsModule, OutboundModule],
  controllers: [DesignBoardController],
  providers: [DesignBoardService],
  exports: [DesignBoardService],
})
export class DesignBoardModule {}
