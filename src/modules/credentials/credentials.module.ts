import { Module } from '@nestjs/common';
import { CredentialCryptoService } from './credential-crypto.service';
import { ProviderCredentialService } from './provider-credential.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CredentialCryptoService, ProviderCredentialService],
  exports: [CredentialCryptoService, ProviderCredentialService],
})
export class CredentialsModule {}
