import 'dotenv/config';
import axios, { type AxiosResponse } from 'axios';
import {
  AccountCampaignTemplateStatus,
  CampaignDefinitionStatus,
  CampaignDefinitionType,
  Prisma,
  PrismaClient,
  ProviderType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CredentialCryptoService } from '../modules/credentials/credential-crypto.service';

type Args = {
  apply: boolean;
  accountId: string | null;
  templateName: string;
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

type Summary = {
  accountsScanned: number;
  credentialErrors: number;
  requestErrors: number;
  templatesMatched: number;
  definitionsCreated: number;
  definitionsExisting: number;
  wouldUpsertAccountTemplates: number;
  accountTemplatesUpserted: number;
  skippedInvalidTemplates: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const DEFAULT_DELAY_MS = 250;
const MAX_RETRIES = 3;
const CAMPAIGN_KEY_PREFIX = 'repetition_reminder';
const CAMPAIGN_NAME = 'Recordatorio de repetición';

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account')?.trim() || null;
  const templateName = readArg(argv, '--template-name')?.trim();
  const limitRaw = readArg(argv, '--limit');
  const delayMsRaw = readArg(argv, '--delay-ms');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  const delayMs = delayMsRaw ? Number(delayMsRaw) : DEFAULT_DELAY_MS;

  if (accountId && !UUID_RE.test(accountId)) {
    throw new Error('--account must be a valid UUID');
  }

  if (!templateName) {
    throw new Error('--template-name is required');
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('--limit must be an integer between 1 and 1000');
  }

  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error('--delay-ms must be an integer between 0 and 60000');
  }

  return { apply, accountId, templateName, limit, delayMs };
}

function readArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDate(value: unknown): Date | null {
  const raw = nonEmpty(value);
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function toAccountCampaignTemplateStatus(
  status: string | null,
): AccountCampaignTemplateStatus {
  const normalized = status?.toUpperCase();

  if (
    normalized &&
    Object.values(AccountCampaignTemplateStatus).includes(
      normalized as AccountCampaignTemplateStatus,
    )
  ) {
    return normalized as AccountCampaignTemplateStatus;
  }

  return AccountCampaignTemplateStatus.ERROR;
}

function toInternalLanguage(ycloudLanguage: string) {
  return ycloudLanguage === 'es' ? 'es_ES' : ycloudLanguage;
}

function campaignDefinitionKey(internalLanguage: string) {
  return `${CAMPAIGN_KEY_PREFIX}_${internalLanguage.toLowerCase()}`;
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
    const response = await requestTemplatePage({
      ...input,
      offset,
    });

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
        headers: {
          'X-API-Key': input.apiKey,
          Accept: 'application/json',
        },
        params: {
          limit: input.limit,
          offset: input.offset,
        },
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

async function ensureCampaignDefinition(input: {
  prisma: PrismaClient;
  apply: boolean;
  internalLanguage: string;
  templateName: string;
  template: YcloudTemplate;
  summary: Summary;
  dryRunPlannedDefinitionKeys: Set<string>;
}) {
  const key = campaignDefinitionKey(input.internalLanguage);
  const existing = await input.prisma.campaignDefinition.findUnique({
    where: { key },
    select: { id: true },
  });

  if (existing) {
    input.summary.definitionsExisting += 1;

    if (input.apply) {
      await input.prisma.campaignDefinition.update({
        where: { id: existing.id },
        data: {
          name: CAMPAIGN_NAME,
          type: CampaignDefinitionType.REPETITION_REMINDER,
          language: input.internalLanguage,
          category: nonEmpty(input.template.category),
          payload: buildDefinitionPayload(input.templateName, input.template),
          status: CampaignDefinitionStatus.ACTIVE,
          isActive: true,
        },
      });
    }

    return existing.id;
  }

  if (!input.dryRunPlannedDefinitionKeys.has(key)) {
    input.summary.definitionsCreated += 1;
    input.dryRunPlannedDefinitionKeys.add(key);
  }

  if (!input.apply) {
    return `dry-run:${key}`;
  }

  const definition = await input.prisma.campaignDefinition.create({
    data: {
      key,
      name: CAMPAIGN_NAME,
      type: CampaignDefinitionType.REPETITION_REMINDER,
      language: input.internalLanguage,
      category: nonEmpty(input.template.category),
      payload: buildDefinitionPayload(input.templateName, input.template),
      status: CampaignDefinitionStatus.ACTIVE,
      isActive: true,
    },
    select: { id: true },
  });

  return definition.id;
}

function buildDefinitionPayload(templateName: string, template: YcloudTemplate) {
  return {
    provider: 'YCLOUD',
    templateName,
    components: Array.isArray(template.components) ? template.components : [],
    variables: [],
  } satisfies Prisma.InputJsonObject;
}

async function syncAccountTemplate(input: {
  prisma: PrismaClient;
  apply: boolean;
  account: AccountCandidate;
  definitionId: string;
  template: YcloudTemplate;
  internalLanguage: string;
}) {
  const officialTemplateId = nonEmpty(input.template.officialTemplateId);
  const wabaId = nonEmpty(input.template.wabaId) ?? input.account.wabaId;
  const name = nonEmpty(input.template.name);
  const language = nonEmpty(input.template.language);

  if (!officialTemplateId || !name || !language || !wabaId) {
    return { kind: 'invalid' as const };
  }

  if (!input.apply) {
    return { kind: 'would_upsert' as const };
  }

  await input.prisma.accountCampaignTemplate.upsert({
    where: {
      accountId_campaignDefinitionId: {
        accountId: input.account.id,
        campaignDefinitionId: input.definitionId,
      },
    },
    update: {
      officialTemplateId,
      wabaId,
      name,
      language,
      category: nonEmpty(input.template.category),
      qualityRating: nonEmpty(input.template.qualityRating),
      status: toAccountCampaignTemplateStatus(nonEmpty(input.template.status)),
      statusDetail: nonEmpty(input.template.statusUpdateEvent),
      ycloudCreateTime: parseDate(input.template.createTime),
      ycloudUpdateTime: parseDate(input.template.updateTime),
      lastSyncedAt: new Date(),
      payloadSnapshot: input.template as Prisma.InputJsonObject,
      lastWebhookPayload: input.template as Prisma.InputJsonObject,
      lastError: null,
      isActive: true,
    },
    create: {
      accountId: input.account.id,
      campaignDefinitionId: input.definitionId,
      officialTemplateId,
      wabaId,
      name,
      language,
      category: nonEmpty(input.template.category),
      qualityRating: nonEmpty(input.template.qualityRating),
      status: toAccountCampaignTemplateStatus(nonEmpty(input.template.status)),
      statusDetail: nonEmpty(input.template.statusUpdateEvent),
      ycloudCreateTime: parseDate(input.template.createTime),
      ycloudUpdateTime: parseDate(input.template.updateTime),
      lastSyncedAt: new Date(),
      payloadSnapshot: input.template as Prisma.InputJsonObject,
      lastWebhookPayload: input.template as Prisma.InputJsonObject,
      isActive: true,
    },
  });

  return { kind: 'upserted' as const };
}

function printSummary(summary: Summary, apply: boolean) {
  console.log('\nYCloud repetition templates sync summary');
  console.log(`- mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`- accounts scanned: ${summary.accountsScanned}`);
  console.log(`- credential errors: ${summary.credentialErrors}`);
  console.log(`- request errors: ${summary.requestErrors}`);
  console.log(`- matching templates found: ${summary.templatesMatched}`);
  console.log(`- campaign definitions existing: ${summary.definitionsExisting}`);
  console.log(`- campaign definitions to create: ${summary.definitionsCreated}`);
  console.log(
    `- account templates that would upsert: ${summary.wouldUpsertAccountTemplates}`,
  );
  console.log(`- account templates upserted: ${summary.accountTemplatesUpserted}`);
  console.log(`- invalid templates skipped: ${summary.skippedInvalidTemplates}`);
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
  const dryRunPlannedDefinitionKeys = new Set<string>();
  const summary: Summary = {
    accountsScanned: 0,
    credentialErrors: 0,
    requestErrors: 0,
    templatesMatched: 0,
    definitionsCreated: 0,
    definitionsExisting: 0,
    wouldUpsertAccountTemplates: 0,
    accountTemplatesUpserted: 0,
    skippedInvalidTemplates: 0,
  };

  console.log(
    `Starting YCloud repetition template sync mode=${args.apply ? 'APPLY' : 'DRY RUN'} templateName=${args.templateName} limit=${args.limit} delayMs=${args.delayMs}`,
  );

  try {
    const accounts = await prisma.account.findMany({
      where: args.accountId ? { id: args.accountId } : {},
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        wabaId: true,
        phoneE164: true,
      },
    });

    for (const account of accounts) {
      summary.accountsScanned += 1;

      const credential = await getCredential({
        prisma,
        cryptoService,
        accountId: account.id,
      });

      if (credential.kind === 'error') {
        summary.credentialErrors += 1;
        console.error(
          `[SKIPPED] account=${account.name} accountId=${account.id} reason=${credential.reason}`,
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
          `[ERROR] account=${account.name} accountId=${account.id} reason=${errorMessage(error)}`,
        );
        continue;
      }

      const matchingTemplates = templates.filter(
        (template) => nonEmpty(template.name) === args.templateName,
      );

      if (matchingTemplates.length === 0) {
        console.warn(
          `[MISSING] account=${account.name} accountId=${account.id} template=${args.templateName}`,
        );
        continue;
      }

      for (const template of matchingTemplates) {
        const ycloudLanguage = nonEmpty(template.language);
        const officialTemplateId = nonEmpty(template.officialTemplateId);

        if (!ycloudLanguage || !officialTemplateId) {
          summary.skippedInvalidTemplates += 1;
          console.warn(
            `[SKIPPED] account=${account.name} template=${args.templateName} reason=missing language or officialTemplateId`,
          );
          continue;
        }

        const internalLanguage = toInternalLanguage(ycloudLanguage);
        summary.templatesMatched += 1;

        const definitionId = await ensureCampaignDefinition({
          prisma,
          apply: args.apply,
          internalLanguage,
          templateName: args.templateName,
          template,
          summary,
          dryRunPlannedDefinitionKeys,
        });

        const result = await syncAccountTemplate({
          prisma,
          apply: args.apply,
          account,
          definitionId,
          template,
          internalLanguage,
        });

        if (result.kind === 'invalid') {
          summary.skippedInvalidTemplates += 1;
          console.warn(
            `[SKIPPED] account=${account.name} template=${args.templateName} lang=${ycloudLanguage} reason=invalid template payload`,
          );
          continue;
        }

        if (result.kind === 'would_upsert') {
          summary.wouldUpsertAccountTemplates += 1;
          console.log(
            `[DRY-RUN] account=${account.name} lang=${internalLanguage} ycloudLang=${ycloudLanguage} template=${args.templateName} status=${nonEmpty(template.status) ?? 'UNKNOWN'} officialTemplateId=${officialTemplateId}`,
          );
        } else {
          summary.accountTemplatesUpserted += 1;
          console.log(
            `[APPLIED] account=${account.name} lang=${internalLanguage} ycloudLang=${ycloudLanguage} template=${args.templateName} status=${nonEmpty(template.status) ?? 'UNKNOWN'} officialTemplateId=${officialTemplateId}`,
          );
        }
      }

      if (args.delayMs > 0) await wait(args.delayMs);
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
  console.error(`YCloud repetition template sync failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
