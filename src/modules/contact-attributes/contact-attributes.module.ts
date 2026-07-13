import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ContactAttributesService } from './contact-attributes.service';

@Module({
  imports: [PrismaModule, CredentialsModule],
  providers: [ContactAttributesService],
  exports: [ContactAttributesService],
})
export class ContactAttributesModule {}
