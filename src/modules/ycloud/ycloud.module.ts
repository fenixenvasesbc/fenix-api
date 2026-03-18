import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { CredentialsModule } from '../credentials/credentials.module';
import { YcloudService } from './ycloud.service';

@Module({
  imports: [HttpModule, CredentialsModule],
  providers: [YcloudService],
  exports: [YcloudService],
})
export class YcloudModule {}