import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CredentialCryptoService } from '../credentials/credential-crypto.service';
import {
  runYcloudLeadNameBackfill,
  type YcloudBackfillArgs,
  type YcloudBackfillSummary,
} from './ycloud-lead-name-sync.core';

/**
 * Version HTTP (rol SUPPORT, ver LeadNameSyncController) del mismo backfill
 * que corre `pnpm ycloud:backfill-lead-names` por CLI. Comparten la logica
 * en ycloud-lead-name-sync.core.ts para no divergir.
 */
@Injectable()
export class LeadNameSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CredentialCryptoService,
  ) {}

  async runYcloudBackfill(
    args: YcloudBackfillArgs,
  ): Promise<YcloudBackfillSummary> {
    return runYcloudLeadNameBackfill(this.prisma, this.cryptoService, args);
  }
}
