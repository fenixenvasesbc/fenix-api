import { Module } from '@nestjs/common';
import { ClichesController } from './cliches.controller';
import { ClichesService } from './cliches.service';

@Module({
  controllers: [ClichesController],
  providers: [ClichesService],
  exports: [ClichesService],
})
export class ClichesModule {}
