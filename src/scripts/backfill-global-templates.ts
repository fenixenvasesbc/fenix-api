// Backfill: importa a la gestion global de plantillas
// (GlobalWhatsappTemplate / GlobalWhatsappTemplateAccount) las plantillas
// que YA existen en YCloud (en cualquier estado: aprobada, pendiente,
// rechazada, etc.), creadas antes de que este modulo existiera o por fuera
// de Fenix, para que aparezcan en el listado de /templates.
//
// Recorre todas las cuentas activas, agrupa lo que encuentra en YCloud por
// (name, language), crea una GlobalWhatsappTemplate por cada combinacion
// nueva (usa como "payload" los components de la primera cuenta en la que
// aparece) y una GlobalWhatsappTemplateAccount por cada cuenta donde esa
// plantilla existe, con su propio estado (la aprobacion es por WABA).
// Idempotente: si (name, language) ya esta en GlobalWhatsappTemplate, NO se
// omite por completo -- se revisan las cuentas y se agregan solo las filas
// de GlobalWhatsappTemplateAccount que falten (por ejemplo, una cuenta que
// ya tenia la plantilla en YCloud pero quedo pendiente en el backfill
// original por no estar aun aprobada).
//
// Uso (por defecto es DRY RUN, no escribe nada):
//   npx ts-node src/scripts/backfill-global-templates.ts
//   npx ts-node src/scripts/backfill-global-templates.ts --apply
//   npx ts-node src/scripts/backfill-global-templates.ts --apply --account=<uuid>
//   npx ts-node src/scripts/backfill-global-templates.ts --apply --delay-ms=500

import 'dotenv/config';
import axios, { type AxiosResponse } from 'axios';
import {
  AccountGlobalTemplateStatus,
  Prisma,
  PrismaClient,
  ProviderType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CredentialCryptoService } from '../modules/credentials/credential-crypto.service';

type Args = {
  apply: boolean;
  accountId: string | null;
  limit: number;
  delayMs: number;
};

type AccountCandidate = {
  id: string;
  name: string;
  wabaId: string;
  phoneE164: string;
};

type CredentialResult =
  | { kind: 'ok'; apiKey: string }
  | { kind: 'error'; reason: string };

type YcloudTemplate = {
  officialTemplateId?: unknown;
  id?: unknown;
  wabaId?: unknown;
  name?: unknown;
  language?: unknown;
  category?: unknown;
  qualityRating?: unknown;
  status?: unknown;
  statusUpdateEvent?: unknown;
  createTime?: unknown;
  updateTime?: unknown;
  components?: unknown;
  [key: string]: unknown;
};

type YcloudTemplateListResponse = {
  offset?: unknown;
  limit?: unknown;
  length?: unknown;
  items?: unknown;
};

type CanonicalTemplate = {
  name: string;
  language: string;
  category: string;
  payload: unknown;
};

type AccountRow = {
  accountId: string;
  wabaId: string;
  officialTemplateId: string | null;
  status: AccountGlobalTemplateStatus;
};

type Summary = {
  accountsScanned: number;
  credentialErrors: number;
  requestErrors: number;
  templatesSeen: number;
  templatesNew: number;
  templatesAlreadyRegistered: number;
  accountRowsWritten: number;
  accountRowsAddedToExisting: number;
};

const VALID_STATUSES = new Set(Object.values(AccountGlobalTemplateStatus));
const DEFAULT_LIMIT = 100;
const DEFAULT_DELAY_MS = 250;
const MAX_RETRIES = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account')?.trim() || null;
  const limitRaw = readArg(argv, '--limit');
  const delayMsRaw = readArg(argv, '--delay-ms');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  const delayMs = delayMsRaw ? Number(delayMsRaw) : DEFAULT_DELAY_MS;

  if (accountId && !UUID_RE.test(accountId)) {
    throw new Error('--account must be a valid UUID');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('--limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error('--delay-ms must be an integer between 0 and 60000');
  }

  return { apply, accountId, limit, delayMs };
}

function readArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mapStatus(value: unknown): AccountGlobalTemplateStatus {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VALID_STATUSES.has(normalized as AccountGlobalTemplateStatus)
    ? (normalized as AccountGlobalTemplateStatus)
    : AccountGlobalTemplateStatus.PENDING;
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

async function requestTemplatePage(input: {
  baseUrl: string;
  apiKey: string;
  limit: number;
  offset: number;
}): Promise<unknown> {
  const url = `${input.baseUrl}/whatsapp/templates`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: AxiosResponse | null = null;

    try {
      const receivedResponse = await axios.get(url, {
        headers: { 'X-API-Key': input.apiKey, Accept: 'application/json' },
        params: { limit: input.limit, offset: input.offset },
        timeout: 20_000,
        validateStatus: () => true,
      });
      response = receivedResponse;

      if (receivedResponse.status >= 200 && receivedResponse.status < 300) {
        return receivedResponse.data;
      }

      const retryable =
        receivedResponse.status === 429 || receivedResponse.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(
          `YCloud templates lookup failed: ${providerMessage(receivedResponse)}`,
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

  throw new Error('YCloud templates lookup exhausted retries');
}

async function listTemplates(input: {
  baseUrl: string;
  apiKey: string;
  limit: number;
  delayMs: number;
}): Promise<YcloudTemplate[]> {
  const templates: YcloudTemplate[] = [];
  let offset = 0;

  while (true) {
    const response = await requestTemplatePage({ ...input, offset });
    const payload = response as YcloudTemplateListResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];

    for (const item of items) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        templates.push(item as YcloudTemplate);
      }
    }

    if (items.length < input.limit) break;

    offset += items.length;
    if (input.delayMs > 0) await wait(input.delayMs);
  }

  return templates;
}

async function getCredential(input: {
  prisma: PrismaClient;
  cryptoService: CredentialCryptoService;
  accountId: string;
}): Promise<CredentialResult> {
  const credential = await input.prisma.accountProviderCredential.findUnique({
    where: {
      accountId_provider: {
        accountId: input.accountId,
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
      apiKey: input.cryptoService.decrypt(credential.apiKeyEncrypted),
    };
  } catch (error) {
    return {
      kind: 'error',
      reason: `credential decrypt failed: ${errorMessage(error)}`,
    };
  }
}

function printSummary(summary: Summary, apply: boolean) {
  console.log('\n' + '='.repeat(70));
  console.log(`Backfill global-templates summary (mode: ${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log('='.repeat(70));
  console.log(`Cuentas escaneadas                 : ${summary.accountsScanned}`);
  console.log(`Errores de credencial               : ${summary.credentialErrors}`);
  console.log(`Errores de request a YCloud          : ${summary.requestErrors}`);
  console.log(`Plantillas vistas en YCloud (total)  : ${summary.templatesSeen}`);
  console.log(`Plantillas nuevas (name+language)    : ${summary.templatesNew}`);
  console.log(`Plantillas ya al dia (sin cambios)   : ${summary.templatesAlreadyRegistered}`);
  console.log(`Filas por cuenta ${apply ? 'creadas' : 'que se crearian'} (plantilla nueva)   : ${summary.accountRowsWritten}`);
  console.log(`Filas por cuenta ${apply ? 'agregadas' : 'que se agregarian'} (plantilla existente): ${summary.accountRowsAddedToExisting}`);
  console.log('='.repeat(70));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const baseUrl = (
    process.env.YCLOUD_BASE_URL ?? 'https://api.ycloud.com/v2'
  ).replace(/\/+$/, '');

  if (!databaseUrl) throw new Error('DATABASE_URL is missing');
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY is missing');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const cryptoService = new CredentialCryptoService();

  const summary: Summary = {
    accountsScanned: 0,
    credentialErrors: 0,
    requestErrors: 0,
    templatesSeen: 0,
    templatesNew: 0,
    templatesAlreadyRegistered: 0,
    accountRowsWritten: 0,
    accountRowsAddedToExisting: 0,
  };

  console.log(
    `Starting global-templates backfill mode=${args.apply ? 'APPLY' : 'DRY RUN'} limit=${args.limit} delayMs=${args.delayMs}${args.accountId ? ` account=${args.accountId}` : ''}`,
  );

  const canonical = new Map<string, CanonicalTemplate>();
  const accountRows = new Map<string, AccountRow[]>();

  try {
    const accounts = await prisma.account.findMany({
      where: {
        user: { isActive: true },
        ...(args.accountId ? { id: args.accountId } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, wabaId: true, phoneE164: true },
    });

    console.log(`Cuentas activas encontradas: ${accounts.length}`);

    for (const account of accounts as AccountCandidate[]) {
      summary.accountsScanned += 1;

      if (!account.wabaId) {
        console.warn(`  [SKIP] ${account.name} (${account.id}) sin wabaId`);
        continue;
      }

      const credential = await getCredential({
        prisma,
        cryptoService,
        accountId: account.id,
      });

      if (credential.kind === 'error') {
        summary.credentialErrors += 1;
        console.error(
          `  [SKIP] account=${account.name} accountId=${account.id} reason=${credential.reason}`,
        );
        continue;
      }

      let templates: YcloudTemplate[];
      try {
        templates = await listTemplates({
          baseUrl,
          apiKey: credential.apiKey,
          limit: args.limit,
          delayMs: args.delayMs,
        });
      } catch (error) {
        summary.requestErrors += 1;
        console.error(
          `  [ERROR] account=${account.name} accountId=${account.id} reason=${errorMessage(error)}`,
        );
        continue;
      }

      summary.templatesSeen += templates.length;
      console.log(
        `  ${account.name} (${account.id}): ${templates.length} plantillas en YCloud`,
      );

      for (const template of templates) {
        const name = nonEmpty(template.name);
        const language = nonEmpty(template.language);
        if (!name || !language) {
          console.warn(
            `    [SKIP] plantilla sin name/language valido en ${account.name}`,
          );
          continue;
        }

        const key = `${name}|${language}`;

        if (!canonical.has(key)) {
          canonical.set(key, {
            name,
            language,
            category: nonEmpty(template.category) ?? 'UTILITY',
            payload: template.components ?? [],
          });
        }

        const rows = accountRows.get(key) ?? [];
        rows.push({
          accountId: account.id,
          wabaId: account.wabaId,
          officialTemplateId: nonEmpty(
            template.officialTemplateId ?? template.id,
          ),
          status: mapStatus(template.status),
        });
        accountRows.set(key, rows);
      }

      if (args.delayMs > 0) await wait(args.delayMs);
    }

    console.log(
      `\nPlantillas distintas (name+language) detectadas como aprobadas: ${canonical.size}`,
    );

    for (const [key, tpl] of canonical) {
      const existing = await prisma.globalWhatsappTemplate.findUnique({
        where: { name_language: { name: tpl.name, language: tpl.language } },
        include: { accountTemplates: { select: { accountId: true } } },
      });

      const rows = accountRows.get(key) ?? [];

      if (existing) {
        const alreadyHasAccountIds = new Set(
          existing.accountTemplates.map((row) => row.accountId),
        );
        const missingRows = rows.filter(
          (row) => !alreadyHasAccountIds.has(row.accountId),
        );

        if (missingRows.length === 0) {
          summary.templatesAlreadyRegistered += 1;
          console.log(
            `  [YA AL DIA] ${tpl.name} (${tpl.language}) -- ya esta en la gestion global y no hay cuentas nuevas que agregar`,
          );
          continue;
        }

        summary.accountRowsAddedToExisting += missingRows.length;
        console.log(
          `  [${args.apply ? 'AGREGAR CUENTAS' : 'DRY-RUN'}] ${tpl.name} (${tpl.language}) -- ya esta en la gestion global, ${missingRows.length} cuenta(s) faltante(s)`,
        );

        if (!args.apply) continue;

        await prisma.globalWhatsappTemplateAccount.createMany({
          data: missingRows.map((row) => ({
            globalTemplateId: existing.id,
            accountId: row.accountId,
            wabaId: row.wabaId,
            officialTemplateId: row.officialTemplateId,
            status: row.status,
            lastSyncedAt: new Date(),
          })),
          skipDuplicates: true,
        });

        continue;
      }

      summary.templatesNew += 1;
      summary.accountRowsWritten += rows.length;
      console.log(
        `  [${args.apply ? 'CREAR' : 'DRY-RUN'}] ${tpl.name} (${tpl.language}) categoria=${tpl.category} -- ${rows.length} cuenta(s)`,
      );

      if (!args.apply) continue;

      await prisma.$transaction(async (tx) => {
        const created = await tx.globalWhatsappTemplate.create({
          data: {
            name: tpl.name,
            language: tpl.language,
            category: tpl.category,
            payload: tpl.payload as Prisma.InputJsonValue,
            createdByUserId: null,
          },
        });

        if (rows.length > 0) {
          await tx.globalWhatsappTemplateAccount.createMany({
            data: rows.map((row) => ({
              globalTemplateId: created.id,
              accountId: row.accountId,
              wabaId: row.wabaId,
              officialTemplateId: row.officialTemplateId,
              status: row.status,
              lastSyncedAt: new Date(),
            })),
            skipDuplicates: true,
          });
        }
      });
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
  console.error(`Global-templates backfill failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
