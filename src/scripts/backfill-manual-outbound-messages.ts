import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type Args = {
  apply: boolean;
  accountId: string;
  wabaId?: string | null;
  phone?: string | null;
  limit: number;
};

type AccountContext = {
  id: string;
  name: string;
  wabaId: string;
  phoneE164: string;
};

type WebhookCandidateRow = {
  webhookId: string;
  providerEventId: string;
  webhookStatus: string;
  webhookCreatedAt: Date;
  providerTime: Date | null;
  payload: Prisma.JsonValue;
  ycloudMessageId: string;
  wamid: string | null;
  externalId: string | null;
  fromPhone: string;
  toPhone: string;
  messageType: string | null;
  messageStatus: string | null;
  textBody: string | null;
  createTime: string | null;
  sendTime: string | null;
  updateTime: string | null;
};

type MessageGroup = {
  key: string;
  events: WebhookCandidateRow[];
};

type MaterializedMessage = {
  messageId: string;
  accountId: string;
  leadId: string;
  ycloudMessageId: string;
  status: MessageStatus;
  eventAt: Date;
};

type MessageStatus = 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT';

const DEFAULT_LIMIT = 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account');
  const wabaId = readArg(argv, '--wabaId');
  const phone = readArg(argv, '--phone');
  const limitRaw = readArg(argv, '--limit');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;

  if (!accountId || !UUID_RE.test(accountId)) {
    throw new Error('--account=<uuid> is required');
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('--limit must be an integer between 1 and 5000');
  }

  return { apply, accountId, wabaId, phone, limit };
}

function readArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function normalizeStatus(value: string | null): MessageStatus | null {
  const normalized = value?.trim().toUpperCase();
  switch (normalized) {
    case 'ACCEPTED':
    case 'SENT':
    case 'DELIVERED':
    case 'READ':
    case 'FAILED':
      return normalized;
    default:
      return null;
  }
}

function statusRank(status: MessageStatus) {
  return (
    {
      ACCEPTED: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: 99,
    } satisfies Record<MessageStatus, number>
  )[status];
}

function normalizeType(value: string | null): MessageType | null {
  switch (value) {
    case 'text':
      return 'TEXT';
    case 'image':
      return 'IMAGE';
    case 'audio':
      return 'AUDIO';
    case 'video':
      return 'VIDEO';
    case 'document':
      return 'DOCUMENT';
    default:
      return null;
  }
}

function parseDate(value: string | null | undefined, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function payloadObject(value: Prisma.JsonValue): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function extractContent(event: WebhookCandidateRow, type: MessageType) {
  const payload = payloadObject(event.payload);
  const whatsappMessage = payloadObject(payload.whatsappMessage);

  if (type === 'TEXT') {
    const textBody = nonEmpty(whatsappMessage.text?.body ?? event.textBody);
    return textBody ? { textBody } : null;
  }

  const mediaKey = type.toLowerCase();
  const media = payloadObject(whatsappMessage[mediaKey]);

  return {
    mediaUrl: nonEmpty(media.link),
    caption: nonEmpty(media.caption),
    fileName: nonEmpty(media.filename),
    mimeType: nonEmpty(media.mime_type),
  };
}

function groupCandidates(rows: WebhookCandidateRow[]) {
  const groups = new Map<string, MessageGroup>();

  for (const row of rows) {
    const key = row.ycloudMessageId || row.wamid;
    if (!key) continue;
    const group = groups.get(key) ?? { key, events: [] };
    group.events.push(row);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    events: group.events.sort(
      (left, right) =>
        eventTime(left).getTime() - eventTime(right).getTime() ||
        left.webhookCreatedAt.getTime() - right.webhookCreatedAt.getTime(),
    ),
  }));
}

function eventTime(row: WebhookCandidateRow) {
  return parseDate(
    row.sendTime ?? row.createTime ?? row.updateTime,
    row.webhookCreatedAt,
  );
}

function latestStatus(events: WebhookCandidateRow[]) {
  return events
    .map((event) => normalizeStatus(event.messageStatus))
    .filter((status): status is MessageStatus => Boolean(status))
    .sort((left, right) => statusRank(right) - statusRank(left))[0];
}

function pickContentEvent(events: WebhookCandidateRow[]) {
  return (
    events.find(
      (event) => event.messageType === 'text' && nonEmpty(event.textBody),
    ) ??
    events.find((event) => normalizeType(event.messageType) !== null) ??
    null
  );
}

async function getAccount(prisma: PrismaClient, args: Args) {
  const account = await prisma.account.findUnique({
    where: { id: args.accountId },
    select: { id: true, name: true, wabaId: true, phoneE164: true },
  });

  if (!account) throw new Error(`Account not found: ${args.accountId}`);
  if (args.wabaId && account.wabaId !== args.wabaId) {
    throw new Error(
      `Account wabaId mismatch. DB=${account.wabaId} input=${args.wabaId}`,
    );
  }
  if (args.phone && account.phoneE164 !== args.phone) {
    throw new Error(
      `Account phone mismatch. DB=${account.phoneE164} input=${args.phone}`,
    );
  }

  return account;
}

async function findCandidates(
  prisma: PrismaClient,
  account: AccountContext,
  limit: number,
) {
  return prisma.$queryRaw<WebhookCandidateRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT
        we."id" AS "webhookId",
        we."providerEventId" AS "providerEventId",
        we."status"::text AS "webhookStatus",
        we."createdAt" AS "webhookCreatedAt",
        we."providerTime" AS "providerTime",
        we."payload" AS "payload",
        we."payload" #>> '{whatsappMessage,id}' AS "ycloudMessageId",
        NULLIF(we."payload" #>> '{whatsappMessage,wamid}', '') AS "wamid",
        NULLIF(we."payload" #>> '{whatsappMessage,externalId}', '') AS "externalId",
        we."payload" #>> '{whatsappMessage,from}' AS "fromPhone",
        we."payload" #>> '{whatsappMessage,to}' AS "toPhone",
        NULLIF(we."payload" #>> '{whatsappMessage,type}', '') AS "messageType",
        NULLIF(we."payload" #>> '{whatsappMessage,status}', '') AS "messageStatus",
        NULLIF(we."payload" #>> '{whatsappMessage,text,body}', '') AS "textBody",
        NULLIF(we."payload" #>> '{whatsappMessage,createTime}', '') AS "createTime",
        NULLIF(we."payload" #>> '{whatsappMessage,sendTime}', '') AS "sendTime",
        NULLIF(we."payload" #>> '{whatsappMessage,updateTime}', '') AS "updateTime"
      FROM "WebhookEvent" we
      WHERE we."eventType" = 'whatsapp.message.updated'
        AND we."payload" #>> '{whatsappMessage,wabaId}' = ${account.wabaId}
        AND we."payload" #>> '{whatsappMessage,from}' = ${account.phoneE164}
        AND we."payload" #>> '{whatsappMessage,id}' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "Message" message
          WHERE message."accountId" = ${account.id}
            AND (
              message."ycloudMessageId" = we."payload" #>> '{whatsappMessage,id}'
              OR (
                NULLIF(we."payload" #>> '{whatsappMessage,wamid}', '') IS NOT NULL
                AND message."wamid" = we."payload" #>> '{whatsappMessage,wamid}'
              )
              OR (
                NULLIF(we."payload" #>> '{whatsappMessage,externalId}', '') IS NOT NULL
                AND message."externalId" = we."payload" #>> '{whatsappMessage,externalId}'
              )
            )
        )
    )
    SELECT *
    FROM candidates
    ORDER BY "webhookCreatedAt" ASC
    LIMIT ${limit}
  `);
}

async function materializeGroup(
  prisma: PrismaClient,
  account: AccountContext,
  group: MessageGroup,
) {
  const contentEvent = pickContentEvent(group.events);
  if (!contentEvent) return null;

  const messageType = normalizeType(contentEvent.messageType);
  const status = latestStatus(group.events);
  if (!messageType || !status) return null;

  const content = extractContent(contentEvent, messageType);
  if (!content) return null;

  const outboundAt = eventTime(contentEvent);
  const latestEvent = group.events[group.events.length - 1];
  const providerUpdateTime = eventTime(latestEvent);

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.upsert({
      where: {
        accountId_phoneE164: {
          accountId: account.id,
          phoneE164: contentEvent.toPhone,
        },
      },
      create: {
        accountId: account.id,
        phoneE164: contentEvent.toPhone,
        status: 'NEW',
        firstOutboundAt: outboundAt,
        lastOutboundAt: outboundAt,
        lastMessageAt: outboundAt,
      },
      update: {
        lastOutboundAt: outboundAt,
        lastMessageAt: outboundAt,
      },
      select: {
        id: true,
        firstOutboundAt: true,
      },
    });

    if (!lead.firstOutboundAt) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { firstOutboundAt: outboundAt },
      });
    }

    const message = await tx.message.create({
      data: {
        accountId: account.id,
        leadId: lead.id,
        direction: 'OUTBOUND',
        type: messageType,
        status,
        ycloudMessageId: contentEvent.ycloudMessageId,
        wamid: contentEvent.wamid,
        externalId: contentEvent.externalId,
        providerCreateTime: parseDate(contentEvent.createTime, outboundAt),
        providerSendTime: parseDate(contentEvent.sendTime, outboundAt),
        providerUpdateTime,
        rawPayload: (latestEvent.payload ?? {}) as Prisma.InputJsonValue,
        ...content,
      },
      select: { id: true },
    });

    const historyRows: Prisma.MessageStatusHistoryCreateManyInput[] = [];
    for (const event of group.events) {
      const toStatus = normalizeStatus(event.messageStatus);
      if (!toStatus) continue;

      historyRows.push({
        messageId: message.id,
        fromStatus: null,
        toStatus,
        providerEventId: event.providerEventId,
        providerTime: eventTime(event),
        payload: (event.payload ?? {}) as Prisma.InputJsonValue,
      });
    }

    if (historyRows.length) {
      await tx.messageStatusHistory.createMany({
        data: historyRows,
      });
    }

    const existingConversation = await tx.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId: account.id,
          leadId: lead.id,
          channel: 'WHATSAPP',
        },
      },
      select: { id: true, lastMessageAt: true, customerWindowExpiresAt: true },
    });

    if (!existingConversation) {
      await tx.conversation.create({
        data: {
          accountId: account.id,
          leadId: lead.id,
          channel: 'WHATSAPP',
          status: 'OPEN',
          lastMessageId: message.id,
          lastOutboundMessageId: message.id,
          lastMessageAt: outboundAt,
          lastOutboundAt: outboundAt,
          isCustomerWindowOpen: false,
          requiresAttention: false,
          unreadCount: 0,
        },
      });
    } else {
      const shouldReplaceLastMessage =
        !existingConversation.lastMessageAt ||
        outboundAt.getTime() >= existingConversation.lastMessageAt.getTime();
      const isCustomerWindowOpen = existingConversation.customerWindowExpiresAt
        ? existingConversation.customerWindowExpiresAt.getTime() > Date.now()
        : false;

      await tx.conversation.update({
        where: { id: existingConversation.id },
        data: {
          status: 'OPEN',
          closedAt: null,
          lastOutboundMessageId: message.id,
          lastOutboundAt: outboundAt,
          isCustomerWindowOpen,
          requiresAttention: false,
          unreadCount: 0,
          ...(shouldReplaceLastMessage
            ? { lastMessageId: message.id, lastMessageAt: outboundAt }
            : {}),
        },
      });
    }

    await tx.webhookEvent.updateMany({
      where: { id: { in: group.events.map((event) => event.webhookId) } },
      data: {
        status: 'PROCESSED',
        accountId: account.id,
        leadId: lead.id,
        messageId: message.id,
        processedAt: new Date(),
        lastError: null,
      },
    });

    return {
      messageId: message.id,
      accountId: account.id,
      leadId: lead.id,
      ycloudMessageId: contentEvent.ycloudMessageId,
      status,
      eventAt: outboundAt,
    } satisfies MaterializedMessage;
  });
}

function printSummary(account: AccountContext, groups: MessageGroup[]) {
  const byType = new Map<string, number>();
  const byStatus = new Map<string, number>();

  for (const group of groups) {
    const event = pickContentEvent(group.events);
    const type = event?.messageType ?? 'unknown';
    const status = latestStatus(group.events) ?? 'unknown';
    byType.set(type, (byType.get(type) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }

  console.log(`Account: ${account.name} (${account.id})`);
  console.log(`WhatsApp: ${account.phoneE164} wabaId=${account.wabaId}`);
  console.log(`Messages to materialize: ${groups.length}`);
  console.log('\nBy type:');
  for (const [type, count] of byType) console.log(`- ${type}: ${count}`);
  console.log('\nBy latest status:');
  for (const [status, count] of byStatus) console.log(`- ${status}: ${count}`);

  if (groups.length) {
    console.log('\nSample:');
    for (const group of groups.slice(0, 10)) {
      const event = pickContentEvent(group.events);
      console.log(
        `- id=${group.key} to=${event?.toPhone} type=${event?.messageType} status=${latestStatus(
          group.events,
        )} events=${group.events.length}`,
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const account = await getAccount(prisma, args);
    const rows = await findCandidates(prisma, account, args.limit);
    const groups = groupCandidates(rows);

    printSummary(account, groups);

    if (!args.apply) {
      console.log('\nDry run only. Add --apply to create messages.');
      return;
    }

    let created = 0;
    let skipped = 0;

    for (const group of groups) {
      try {
        const result = await materializeGroup(prisma, account, group);
        if (result) {
          created += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        console.error(
          `Failed group=${group.key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    console.log(`\nCreated messages: ${created}`);
    console.log(`Skipped messages: ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
