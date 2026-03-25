import { ProviderType } from '@prisma/client';


import { Injectable, NotFoundException } from '@nestjs/common';

import { CredentialCryptoService } from './credential-crypto.service';

import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ProviderCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CredentialCryptoService,
  ) {}

  async getYcloudApiKey(accountId: string): Promise<string> {
    const credential = await this.prisma.accountProviderCredential.findUnique({
      where: {
        accountId_provider: {
          accountId,
          provider: ProviderType.YCLOUD,
        },
      },
      select: {
        apiKeyEncrypted: true,
        isActive: true,
      },
    });

    if (!credential || !credential.isActive) {
      throw new NotFoundException(
        `Active YCLOUD credential not found for accountId=${accountId}`,
      );
    }

    return this.cryptoService.decrypt(credential.apiKeyEncrypted);
  }

  async saveYcloudApiKey(accountId: string, apiKey: string): Promise<void> {
    const apiKeyEncrypted = this.cryptoService.encrypt(apiKey);
    const apiKeyHint = this.cryptoService.buildHint(apiKey);

    await this.prisma.accountProviderCredential.upsert({
      where: {
        accountId_provider: {
          accountId,
          provider: ProviderType.YCLOUD,
        },
      },
      update: {
        apiKeyEncrypted,
        apiKeyHint,
        isActive: true,
      },
      create: {
        accountId,
        provider: ProviderType.YCLOUD,
        apiKeyEncrypted,
        apiKeyHint,
        isActive: true,
      },
    });
  }
}
