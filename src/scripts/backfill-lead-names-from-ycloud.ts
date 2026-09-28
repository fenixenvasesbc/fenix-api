import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CredentialCryptoService } from '../modules/credentials/credential-crypto.service';
import {
  runYcloudLeadNameBackfill,
  type YcloudBackfillArgs,
  type YcloudBackfillSummary,
} from '../modules/lead-name-sync/ycloud-lead-name-sync.core';

// CLI para el mismo backfill que expone POST /lead-name-sync/ycloud-backfill
// (rol SUPPORT). La logica vive en ycloud-lead-name-sync.core.ts; este
// archivo solo se ocupa de: parsear argv, instanciar PrismaClient a mano
// (fuera del contexto de Nest), imprimir el resumen y el exit code.

type Args = YcloudBackfillArgs;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 250;

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account')?.trim() || null;
  const limitRaw = readArg(argv, '--limit');
  const concurrencyRaw = readArg(argv, '--concurrency');
  const delayMsRaw = readArg(argv, '--delay-ms');
  const limit = limitRaw === undefined ? null : Number(limitRaw);
  const concurrency = concurrencyRaw
    ? Number(concurrencyRaw)
    : DEFAULT_CONCURRENCY;
  const delayMs = delayMsRaw ? Number(delayMsRaw) : DEFAULT_DELAY_MS;

  if (accountId && !UUID_RE.test(accountId)) {
    throw new Error('--account must be a valid UUID');
  }

  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error('--concurrency must be an integer between 1 and 20');
  }

  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error('--delay-ms must be an integer between 0 and 60000');
  }

  return { apply, accountId, limit, concurrency, delayMs };
}

function readArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function printSummary(summary: YcloudBackfillSummary, apply: boolean) {
  console.log('\nBackfill summary');
  console.log(`- mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`- leads scanned: ${summary.scanned}`);
  console.log(`- invalid phones: ${summary.invalidPhone}`);
  console.log(`- skipped by credential error: ${summary.credentialErrors}`);
  console.log(`- contacts not found: ${summary.notFound}`);
  console.log(`- contacts without remarkName: ${summary.withoutRemarkName}`);
  console.log(`- contacts without nickname: ${summary.withoutNickname}`);
  console.log(`- names already synchronized: ${summary.unchanged}`);
  console.log(`- names that would change: ${summary.wouldUpdate}`);
  console.log(`- names updated: ${summary.updated}`);
  console.log(`- concurrent changes preserved: ${summary.concurrentChanges}`);
  console.log(`- request errors: ${summary.requestErrors}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!databaseUrl) throw new Error('DATABASE_URL is missing');
  if (!encryptionKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is missing');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const cryptoService = new CredentialCryptoService();

  let summary: YcloudBackfillSummary;
  try {
    summary = await runYcloudLeadNameBackfill(prisma, cryptoService, args);
  } finally {
    await prisma.$disconnect();
  }

  printSummary(summary, args.apply);

  if (summary.credentialErrors > 0 || summary.requestErrors > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`Backfill failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
