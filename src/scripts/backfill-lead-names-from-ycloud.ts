import 'dotenv/config';
import axios, { type AxiosResponse } from 'axios';
import { LeadStatus, PrismaClient, ProviderType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CredentialCryptoService } from '../modules/credentials/credential-crypto.service';

type Args = {
  apply: boolean;
  accountId: string | null;
  limit: number | null;
  concurrency: number;
  delayMs: number;
};

type LeadCandidate = {
  id: string;
  accountId: string | null;
  phoneE164: string;
  ycloudNickname: string | null;
};

type ContactLookup =
  | { kind: 'found'; nickname: string | null }
  | { kind: 'not_found' };

type CredentialResult =
  | { kind: 'ok'; apiKey: string }
  | { kind: 'error'; reason: string };

type Summary = {
  scanned: number;
  invalidPhone: number;
  credentialErrors: number;
  notFound: number;
  withoutNickname: number;
  unchanged: number;
  wouldUpdate: number;
  updated: number;
  concurrentChanges: number;
  requestErrors: number;
};

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 250;
const DATABASE_BATCH_SIZE = 250;
const MAX_RETRIES = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_RE = /^\+[1-9]\d{6,14}$/;

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

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractNickname(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;

  return nonEmpty(
    root.nickname ?? root.nickName ?? nested?.nickname ?? nested?.nickName,
  );
}

function providerMessage(response: AxiosResponse): string {
  const body = response.data as
    | { message?: unknown; error?: { message?: unknown } }
    | undefined;

  return (
    nonEmpty(body?.message) ??
    nonEmpty(body?.error?.message) ??
    `HTTP ${response.status}`
  );
}

function retryDelayMs(response: AxiosResponse | null, attempt: number) {
  const retryAfter: unknown = response
    ? (response.headers as Record<string, unknown>)['retry-after']
    : undefined;
  const retryAfterSeconds =
    typeof retryAfter === 'string' ? Number(retryAfter) : Number.NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, 10_000);
  }

  return Math.min(500 * 2 ** attempt, 5_000);
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retrieveContact(input: {
  baseUrl: string;
  apiKey: string;
  phoneE164: string;
  beforeRequest: () => Promise<void>;
}): Promise<ContactLookup> {
  const url = `${input.baseUrl}/contact/contacts/${encodeURIComponent(
    input.phoneE164,
  )}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: AxiosResponse | null = null;

    try {
      await input.beforeRequest();
      const receivedResponse = await axios.get(url, {
        headers: {
          'X-API-Key': input.apiKey,
          Accept: 'application/json',
        },
        timeout: 20_000,
        validateStatus: () => true,
      });
      response = receivedResponse;

      if (receivedResponse.status === 200) {
        return {
          kind: 'found',
          nickname: extractNickname(receivedResponse.data),
        };
      }

      if (receivedResponse.status === 404) {
        return { kind: 'not_found' };
      }

      const retryable =
        receivedResponse.status === 429 || receivedResponse.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(
          `YCloud contact lookup failed: ${providerMessage(receivedResponse)}`,
        );
      }
    } catch (error) {
      const isFinalAttempt = attempt === MAX_RETRIES;
      const isHttpFailure =
        response !== null && response.status !== 429 && response.status < 500;

      if (isFinalAttempt || isHttpFailure) {
        throw error;
      }
    }

    await wait(retryDelayMs(response, attempt));
  }

  throw new Error('YCloud contact lookup exhausted retries');
}

function maskPhone(phoneE164: string) {
  if (phoneE164.length <= 6) return '***';
  return `${phoneE164.slice(0, 3)}***${phoneE164.slice(-3)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runConcurrent<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
) {
  for (let offset = 0; offset < values.length; offset += concurrency) {
    await Promise.all(
      values
        .slice(offset, offset + concurrency)
        .map((value) => operation(value)),
    );
  }
}

function printSummary(summary: Summary, apply: boolean) {
  console.log('\nBackfill summary');
  console.log(`- mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`- leads scanned: ${summary.scanned}`);
  console.log(`- invalid phones: ${summary.invalidPhone}`);
  console.log(`- skipped by credential error: ${summary.credentialErrors}`);
  console.log(`- contacts not found: ${summary.notFound}`);
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
  const baseUrl = (
    process.env.YCLOUD_BASE_URL ?? 'https://api.ycloud.com/v2'
  ).replace(/\/+$/, '');

  if (!databaseUrl) throw new Error('DATABASE_URL is missing');
  if (!encryptionKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is missing');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const cryptoService = new CredentialCryptoService();
  const credentialCache = new Map<string, Promise<CredentialResult>>();
  const loggedCredentialErrors = new Set<string>();
  let nextRequestAt = 0;
  const summary: Summary = {
    scanned: 0,
    invalidPhone: 0,
    credentialErrors: 0,
    notFound: 0,
    withoutNickname: 0,
    unchanged: 0,
    wouldUpdate: 0,
    updated: 0,
    concurrentChanges: 0,
    requestErrors: 0,
  };

  const getCredential = (accountId: string) => {
    const cached = credentialCache.get(accountId);
    if (cached) return cached;

    const lookup = (async (): Promise<CredentialResult> => {
      const credential = await prisma.accountProviderCredential.findUnique({
        where: {
          accountId_provider: {
            accountId,
            provider: ProviderType.YCLOUD,
          },
        },
        select: { apiKeyEncrypted: true, isActive: true },
      });

      if (!credential?.isActive) {
        return { kind: 'error', reason: 'active YCLOUD credential not found' };
      }

      try {
        return {
          kind: 'ok',
          apiKey: cryptoService.decrypt(credential.apiKeyEncrypted),
        };
      } catch (error) {
        return {
          kind: 'error',
          reason: `credential decrypt failed: ${errorMessage(error)}`,
        };
      }
    })();

    credentialCache.set(accountId, lookup);
    return lookup;
  };

  const waitForRequestSlot = async () => {
    const scheduledAt = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = scheduledAt + args.delayMs;
    const waitMs = scheduledAt - Date.now();

    if (waitMs > 0) await wait(waitMs);
  };

  const processLead = async (lead: LeadCandidate) => {
    summary.scanned += 1;

    if (!lead.accountId) {
      summary.credentialErrors += 1;
      return;
    }

    const phoneE164 = lead.phoneE164.trim();
    if (!E164_RE.test(phoneE164)) {
      summary.invalidPhone += 1;
      console.warn(
        `Skipping invalid E.164 phone leadId=${lead.id} phone=${maskPhone(phoneE164)}`,
      );
      return;
    }

    const credential = await getCredential(lead.accountId);
    if (credential.kind === 'error') {
      summary.credentialErrors += 1;
      if (!loggedCredentialErrors.has(lead.accountId)) {
        loggedCredentialErrors.add(lead.accountId);
        console.error(
          `Skipping accountId=${lead.accountId}: ${credential.reason}`,
        );
      }
      return;
    }

    let contact: ContactLookup;
    try {
      contact = await retrieveContact({
        baseUrl,
        apiKey: credential.apiKey,
        phoneE164,
        beforeRequest: waitForRequestSlot,
      });
    } catch (error) {
      summary.requestErrors += 1;
      console.error(
        `Lookup failed leadId=${lead.id} phone=${maskPhone(phoneE164)}: ${errorMessage(error)}`,
      );
      return;
    }

    if (contact.kind === 'not_found') {
      summary.notFound += 1;
      return;
    }

    if (!contact.nickname) {
      summary.withoutNickname += 1;
      return;
    }

    if (lead.ycloudNickname === contact.nickname) {
      summary.unchanged += 1;
      return;
    }

    summary.wouldUpdate += 1;
    if (!args.apply) return;

    const update = await prisma.lead.updateMany({
      where: { id: lead.id, ycloudNickname: lead.ycloudNickname },
      data: { ycloudNickname: contact.nickname },
    });

    if (update.count === 1) {
      summary.updated += 1;
    } else {
      summary.concurrentChanges += 1;
      console.warn(`Concurrent lead change preserved leadId=${lead.id}`);
    }
  };

  console.log(
    `Starting YCloud lead-name backfill mode=${args.apply ? 'APPLY' : 'DRY RUN'} concurrency=${args.concurrency} delayMs=${args.delayMs} status!=${LeadStatus.NEW}`,
  );

  let cursor: string | undefined;

  try {
    while (args.limit === null || summary.scanned < args.limit) {
      const remaining =
        args.limit === null
          ? DATABASE_BATCH_SIZE
          : Math.min(DATABASE_BATCH_SIZE, args.limit - summary.scanned);

      const leads = await prisma.lead.findMany({
        where: {
          accountId: args.accountId ? args.accountId : { not: null },
          phoneE164: { not: '' },
          status: { not: LeadStatus.NEW },
        },
        orderBy: { id: 'asc' },
        take: remaining,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          accountId: true,
          phoneE164: true,
          ycloudNickname: true,
        },
      });

      if (leads.length === 0) break;

      await runConcurrent(leads, args.concurrency, processLead);
      cursor = leads.at(-1)?.id;
    }
  } finally {
    printSummary(summary, args.apply);
    await prisma.$disconnect();
  }

  if (summary.credentialErrors > 0 || summary.requestErrors > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`Backfill failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
