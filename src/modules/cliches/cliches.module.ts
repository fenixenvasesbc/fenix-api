import { Module } from '@nestjs/common';
import { ClichesController } from './cliches.controller';
import { ClichesService } from './cliches.service';
import { ClicheProductionService } from './cliche-production.service';
import { ProductionPdfParserService } from './production-pdf-parser.service';

@Module({
  controllers: [ClichesController],
  providers: [
    ClichesService,
    ClicheProductionService,
    ProductionPdfParserService,
  ],
  exports: [ClichesService],
})
export class ClichesModule {}
