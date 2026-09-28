import axios, { type AxiosResponse } from 'axios';
import { LeadStatus, PrismaClient, ProviderType } from '@prisma/client';
import { CredentialCryptoService } from '../credentials/credential-crypto.service';

// Logica compartida entre:
//  - el script de linea de comandos (src/scripts/backfill-lead-names-from-ycloud.ts)
//  - el endpoint HTTP (POST /lead-name-sync/ycloud-backfill, solo rol SUPPORT)
//
// Se extrajo de forma que ninguno de los dos reimplemente la logica de
// consulta a YCloud / actualizacion de leads: un solo lugar, dos formas de
// dispararlo.

export type YcloudBackfillArgs = {
  apply: boolean;
  accountId: string | null;
  limit: number | null;
  concurrency: number;
  delayMs: number;
};

export type YcloudBackfillSummary = {
  scanned: number;
  invalidPhone: number;
  credentialErrors: number;
  notFound: number;
  withoutRemarkName: number;
  withoutNickname: number;
  unchanged: number;
  wouldUpdate: number;
  updated: number;
  concurrentChanges: number;
  requestErrors: number;
};

type LeadCandidate = {
  id: string;
  accountId: string | null;
  phoneE164: string;
  whatsappContactName: string | null;
  ycloudNickname: string | null;
};

type ContactLookup =
  | {
      kind: 'found';
      whatsappContactName: string | null;
      ycloudNickname: string | null;
    }
  | { kind: 'not_found' };

type CredentialResult =
  | { kind: 'ok'; apiKey: string }
  | { kind: 'error'; reason: string };

// Subconjunto de PrismaClient que esta logica necesita -- PrismaService (el
// provider inyectado en el modulo Nest) extiende PrismaClient, asi que
// cumple esta interfaz sin adaptacion; el script de CLI le pasa su propia
// instancia de PrismaClient directamente.
export type LeadNameSyncPrismaClient = Pick<
  PrismaClient,
  'lead' | 'accountProviderCredential'
>;

export type YcloudBackfillLogger = {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const DATABASE_BATCH_SIZE = 250;
const MAX_RETRIES = 3;
const E164_RE = /^\+[1-9]\d{6,14}$/;

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function pickObjectValue(
  object: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      return object[key];
    }
  }

  const normalizedKeys = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(object)) {
    if (normalizedKeys.has(normalizeKey(key))) return value;
  }

  return null;
}

function objectCandidates(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const candidates = [root];

  for (const key of ['data', 'contact']) {
    const nested = root[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  return candidates;
}

function extractContactNames(payload: unknown): {
  whatsappContactName: string | null;
  ycloudNickname: string | null;
} {
  let whatsappContactName: string | null = null;
  let ycloudNickname: string | null = null;

  for (const object of objectCandidates(payload)) {
    whatsappContactName ??= nonEmpty(
      pickObjectValue(object, [
        'remarkName',
        'remark_name',
        'remark name',
        'fullName',
        'full_name',
      ]),
    );
    ycloudNickname ??= nonEmpty(
      pickObjectValue(object, ['nickname', 'nickName', 'nick_name']),
    );
  }

  return { whatsappContactName, ycloudNickname };
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
        const names = extractContactNames(receivedResponse.data);
        return {
          kind: 'found',
          whatsappContactName: names.whatsappContactName,
          ycloudNickname: names.ycloudNickname,
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

const consoleLogger: YcloudBackfillLogger = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

/**
 * Sincroniza whatsappContactName/ycloudNickname de cada Lead con lo que
 * YCloud (agenda de WhatsApp Business) tiene guardado para ese telefono.
 *
 * NO toca manualName, name (legacy) ni whatsappProfileName -- ver
 * src/common/utils/lead-name.ts para el orden de prioridad que arma
 * displayName a partir de estas fuentes.
 */
export async function runYcloudLeadNameBackfill(
  prisma: LeadNameSyncPrismaClient,
  cryptoService: CredentialCryptoService,
  args: YcloudBackfillArgs,
  options?: { baseUrl?: string; logger?: YcloudBackfillLogger },
): Promise<YcloudBackfillSummary> {
  const baseUrl = (
    options?.baseUrl ??
    process.env.YCLOUD_BASE_URL ??
    'https://api.ycloud.com/v2'
  ).replace(/\/+$/, '');
  const logger = options?.logger ?? consoleLogger;

  const credentialCache = new Map<string, Promise<CredentialResult>>();
  const loggedCredentialErrors = new Set<string>();
  let nextRequestAt = 0;
  const summary: YcloudBackfillSummary = {
    scanned: 0,
    invalidPhone: 0,
    credentialErrors: 0,
    notFound: 0,
    withoutRemarkName: 0,
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
      logger.warn(
        `Skipping invalid E.164 phone leadId=${lead.id} phone=${maskPhone(phoneE164)}`,
      );
      return;
    }

    const credential = await getCredential(lead.accountId);
    if (credential.kind === 'error') {
      summary.credentialErrors += 1;
      if (!loggedCredentialErrors.has(lead.accountId)) {
        loggedCredentialErrors.add(lead.accountId);
        logger.error(
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
      logger.error(
        `Lookup failed leadId=${lead.id} phone=${maskPhone(phoneE164)}: ${errorMessage(error)}`,
      );
      return;
    }

    if (contact.kind === 'not_found') {
      summary.notFound += 1;
      return;
    }

    if (!contact.whatsappContactName) {
      summary.withoutRemarkName += 1;
    }

    if (!contact.ycloudNickname) {
      summary.withoutNickname += 1;
    }

    const nextWhatsappContactName =
      contact.whatsappContactName ?? lead.whatsappContactName;
    const nextYcloudNickname = contact.ycloudNickname ?? lead.ycloudNickname;

    if (
      lead.whatsappContactName === nextWhatsappContactName &&
      lead.ycloudNickname === nextYcloudNickname
    ) {
      summary.unchanged += 1;
      return;
    }

    summary.wouldUpdate += 1;
    if (!args.apply) return;

    const update = await prisma.lead.updateMany({
      where: {
        id: lead.id,
        whatsappContactName: lead.whatsappContactName,
        ycloudNickname: lead.ycloudNickname,
      },
      data: {
        whatsappContactName: nextWhatsappContactName,
        ycloudNickname: nextYcloudNickname,
      },
    });

    if (update.count === 1) {
      summary.updated += 1;
    } else {
      summary.concurrentChanges += 1;
      logger.warn(`Concurrent lead change preserved leadId=${lead.id}`);
    }
  };

  logger.log(
    `Starting YCloud lead-name backfill mode=${args.apply ? 'APPLY' : 'DRY RUN'} concurrency=${args.concurrency} delayMs=${args.delayMs} status!=${LeadStatus.NEW}`,
  );

  let cursor: string | undefined;

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
        whatsappContactName: true,
        ycloudNickname: true,
      },
    });

    if (leads.length === 0) break;

    await runConcurrent(leads, args.concurrency, processLead);
    cursor = leads.at(-1)?.id;
  }

  return summary;
}
