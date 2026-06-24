import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type CandidateRow = {
  accountId: string;
  accountName: string;
  leadId: string;
  lastMessageId: string;
  lastMessageAt: Date;
  lastInboundMessageId: string | null;
  lastInboundAt: Date | null;
  lastOutboundMessageId: string | null;
  lastOutboundAt: Date | null;
};

const BATCH_SIZE = 500;

function parseArgs(args: string[]) {
  const apply = args.includes('--apply');
  const accountArg = args.find((arg) => arg.startsWith('--account='));
  const accountId = accountArg?.slice('--account='.length).trim() || null;

  if (
    accountId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      accountId,
    )
  ) {
    throw new Error('--account must be a valid UUID');
  }

  return { apply, accountId };
}

function toConversationData(
  candidate: CandidateRow,
  now: Date,
): Prisma.ConversationCreateManyInput {
  const customerWindowExpiresAt = candidate.lastInboundAt
    ? new Date(candidate.lastInboundAt.getTime() + 24 * 60 * 60 * 1000)
    : null;

  return {
    id: randomUUID(),
    accountId: candidate.accountId,
    leadId: candidate.leadId,
    channel: 'WHATSAPP',
    status: 'OPEN',
    lastMessageId: candidate.lastMessageId,
    lastInboundMessageId: candidate.lastInboundMessageId,
    lastOutboundMessageId: candidate.lastOutboundMessageId,
    lastMessageAt: candidate.lastMessageAt,
    lastInboundAt: candidate.lastInboundAt,
    lastOutboundAt: candidate.lastOutboundAt,
    customerWindowExpiresAt,
    isCustomerWindowOpen: Boolean(
      customerWindowExpiresAt &&
      customerWindowExpiresAt.getTime() > now.getTime(),
    ),
    requiresAttention: false,
    unreadCount: 0,
  };
}

async function findCandidates(prisma: PrismaClient, accountId: string | null) {
  const accountFilter = accountId
    ? Prisma.sql`AND pairs."accountId" = ${accountId}`
    : Prisma.empty;

  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH pairs AS (
      SELECT DISTINCT message."accountId", message."leadId"
      FROM "Message" AS message
    )
    SELECT
      pairs."accountId" AS "accountId",
      account."name" AS "accountName",
      pairs."leadId" AS "leadId",
      latest."id" AS "lastMessageId",
      latest."eventAt" AS "lastMessageAt",
      inbound."id" AS "lastInboundMessageId",
      inbound."eventAt" AS "lastInboundAt",
      outbound."id" AS "lastOutboundMessageId",
      outbound."eventAt" AS "lastOutboundAt"
    FROM pairs
    INNER JOIN "Lead" AS lead
      ON lead."id" = pairs."leadId"
      AND lead."accountId" = pairs."accountId"
    INNER JOIN "Account" AS account
      ON account."id" = pairs."accountId"
    INNER JOIN LATERAL (
      SELECT
        message."id",
        COALESCE(
          message."providerSendTime",
          message."providerCreateTime",
          message."createdAt"
        ) AS "eventAt"
      FROM "Message" AS message
      WHERE message."accountId" = pairs."accountId"
        AND message."leadId" = pairs."leadId"
      ORDER BY "eventAt" DESC, message."createdAt" DESC, message."id" DESC
      LIMIT 1
    ) AS latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        message."id",
        COALESCE(
          message."providerSendTime",
          message."providerCreateTime",
          message."createdAt"
        ) AS "eventAt"
      FROM "Message" AS message
      WHERE message."accountId" = pairs."accountId"
        AND message."leadId" = pairs."leadId"
        AND message."direction" = 'INBOUND'
      ORDER BY "eventAt" DESC, message."createdAt" DESC, message."id" DESC
      LIMIT 1
    ) AS inbound ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        message."id",
        COALESCE(message."providerCreateTime", message."createdAt") AS "eventAt"
      FROM "Message" AS message
      WHERE message."accountId" = pairs."accountId"
        AND message."leadId" = pairs."leadId"
        AND message."direction" = 'OUTBOUND'
      ORDER BY "eventAt" DESC, message."createdAt" DESC, message."id" DESC
      LIMIT 1
    ) AS outbound ON TRUE
    WHERE NOT EXISTS (
      SELECT 1
      FROM "Conversation" AS conversation
      WHERE conversation."accountId" = pairs."accountId"
        AND conversation."leadId" = pairs."leadId"
        AND conversation."channel" = 'WHATSAPP'
    )
    ${accountFilter}
    ORDER BY account."name", latest."eventAt" DESC
  `);
}

function printSummary(candidates: CandidateRow[]) {
  const byAccount = new Map<string, { name: string; count: number }>();

  for (const candidate of candidates) {
    const current = byAccount.get(candidate.accountId);
    byAccount.set(candidate.accountId, {
      name: candidate.accountName,
      count: (current?.count ?? 0) + 1,
    });
  }

  console.log(`Missing conversations: ${candidates.length}`);
  for (const [accountId, summary] of byAccount) {
    console.log(`- ${summary.name} (${accountId}): ${summary.count}`);
  }

  if (candidates.length > 0) {
    console.log('\nSample:');
    for (const candidate of candidates.slice(0, 10)) {
      console.log(
        `- accountId=${candidate.accountId} leadId=${candidate.leadId} lastMessageAt=${candidate.lastMessageAt.toISOString()}`,
      );
    }
  }
}

async function main() {
  const { apply, accountId } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const candidates = await findCandidates(prisma, accountId);
    printSummary(candidates);

    if (!apply) {
      console.log('\nDry run only. Add --apply to create these conversations.');
      return;
    }

    if (candidates.length === 0) {
      console.log('\nNothing to backfill.');
      return;
    }

    const now = new Date();
    let created = 0;

    for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
      const batch = candidates
        .slice(index, index + BATCH_SIZE)
        .map((candidate) => toConversationData(candidate, now));
      const result = await prisma.conversation.createMany({
        data: batch,
        skipDuplicates: true,
      });
      created += result.count;
    }

    console.log(`\nCreated conversations: ${created}`);
    console.log(
      `Skipped by concurrent/existing records: ${candidates.length - created}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
