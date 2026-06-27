import { Module } from '@nestjs/common';
import { ClichesController } from './cliches.controller';
import { ClichesService } from './cliches.service';
import { ClicheProductionService } from './cliche-production.service';
import { ProductionPdfParserService } from './production-pdf-parser.service';
import { ProductionPdfAnnotatorService } from './production-pdf-annotator.service';

@Module({
  controllers: [ClichesController],
  providers: [
    ClichesService,
    ClicheProductionService,
    ProductionPdfParserService,
    ProductionPdfAnnotatorService,
  ],
  exports: [ClichesService],
})
export class ClichesModule {}
