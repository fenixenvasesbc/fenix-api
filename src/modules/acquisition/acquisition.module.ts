import { Module } from '@nestjs/common';
import { AcquisitionCatalogService } from './acquisition-catalog.service';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionReportService } from './acquisition-report.service';
import { AcquisitionTouchService } from './acquisition-touch.service';

// ADR-007. Exporta AcquisitionTouchService para que EventsService registre
// los toques de captacion al recibir el envio de n8n.
@Module({
  controllers: [AcquisitionController],
  providers: [AcquisitionCatalogService, AcquisitionReportService, AcquisitionTouchService],
  exports: [AcquisitionTouchService],
})
export class AcquisitionModule {}
