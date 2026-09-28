import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { LeadNameSyncController } from './lead-name-sync.controller';
import { LeadNameSyncService } from './lead-name-sync.service';

@Module({
  imports: [CredentialsModule],
  controllers: [LeadNameSyncController],
  providers: [LeadNameSyncService],
})
export class LeadNameSyncModule {}
