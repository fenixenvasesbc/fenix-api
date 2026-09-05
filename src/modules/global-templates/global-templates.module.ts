import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { YcloudModule } from '../ycloud/ycloud.module';
import { GlobalTemplatesController } from './global-templates.controller';
import { GlobalTemplatesService } from './global-templates.service';

@Module({
  imports: [AccountsModule, YcloudModule, CloudinaryModule],
  controllers: [GlobalTemplatesController],
  providers: [GlobalTemplatesService],
  exports: [GlobalTemplatesService],
})
export class GlobalTemplatesModule {}
