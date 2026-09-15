import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BusinessDaysService } from './business-days.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [BusinessDaysService],
  exports: [BusinessDaysService],
})
export class BusinessDaysModule {}
