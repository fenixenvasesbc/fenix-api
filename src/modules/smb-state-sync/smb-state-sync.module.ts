import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SmbStateSyncService } from './smb-state-sync.service';

@Module({
  imports: [PrismaModule],
  providers: [SmbStateSyncService],
  exports: [SmbStateSyncService],
})
export class SmbStateSyncModule {}
