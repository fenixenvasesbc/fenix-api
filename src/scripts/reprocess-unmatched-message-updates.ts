import 'dotenv/config';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitmqModule } from '../modules/rabbitmq/rabbitmq.module';
import { ChatEventsModule } from '../modules/chat-events/chat-events.module';
import { MessageStatusModule } from '../modules/message-status/message-status.module';
import { MessageStatusService } from '../modules/message-status/message-status.service';
import type { WebhookInboxJob } from '../common/types/webhook-inbox-job';
import { errorMessage } from '../common/utils/logging';

// Vuelve a procesar webhooks whatsapp.message.updated que se quedaron sin
// mensaje asociado (WebhookEvent.messageId = null), con la lógica actual de
// MessageStatusService.
//
// Caso de uso: plantillas enviadas fuera de Fenix (panel de YCloud, n8n…) que
// antes se descartaban con "Manual outbound reconstruction skipped
// reason=unsupported_type". Tras el cambio que añade type=template a la
// reconstrucción, este script las crea en la conversación con su hora real.
//
// Uso (dry-run por defecto, solo lista):
//   pnpm messages:reprocess-unmatched-updates -- --since=2026-11-18
//   pnpm messages:reprocess-unmatched-updates -- --since=2026-11-18 --type=template --apply
//
// Opciones:
//   --since=YYYY-MM-DD   (obligatorio) webhooks recibidos desde esa fecha
//   --type=template      tipo de mensaje del payload (por defecto: template;
//                        "all" para cualquier tipo)
//   --accountId=<uuid>   limitar a una cuenta (por wabaId del payload no se
//                        puede, el WebhookEvent sin mensaje no tiene cuenta)
//   --limit=500          máximo de webhooks a procesar
//   --apply              procesar de verdad (sin esto solo lista)
//
// Es idempotente: la reconstrucción hace upsert por (accountId,
// ycloudMessageId), y los estados solo avanzan (sent → delivered → read).
// Los webhooks se procesan en orden de hora del proveedor.

type Args = {
  since: Date;
  type: string;
  accountId: string | null;
  limit: number;
  apply: boolean;
};

type Row = {
  providerEventId: string;
  eventType: string;
  apiVersion: string | null;
  providerTime: Date | null;
  createdAt: Date;
  payload: Prisma.JsonValue;
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RabbitmqModule,
    ChatEventsModule,
    MessageStatusModule,
  ],
})
class ReprocessModule {}

function parseArgs(argv: string[]): Args {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const sinceRaw = get('since');
  if (!sinceRaw) {
    throw new Error('Falta --since=YYYY-MM-DD');
  }
  const since = new Date(sinceRaw);
  if (Number.isNaN(since.getTime())) {
    throw new Error(`--since inválido: ${sinceRaw}`);
  }

  return {
    since,
    type: (get('type') ?? 'template').toLowerCase(),
    accountId: get('accountId') ?? null,
    limit: Number(get('limit') ?? 500),
    apply: argv.includes('--apply'),
  };
}

async function bootstrap() {
  const logger = new Logger('ReprocessUnmatchedMessageUpdates');
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(ReprocessModule, {
    logger: ['log', 'error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const messageStatus = app.get(MessageStatusService);

    const typeFilter =
      args.type === 'all'
        ? Prisma.empty
        : Prisma.sql`AND lower(w."payload"->'whatsappMessage'->>'type') = ${args.type}`;
    const accountFilter = args.accountId
      ? Prisma.sql`AND (w."accountId" = ${args.accountId} OR w."accountId" IS NULL)`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT w."providerEventId", w."eventType", w."apiVersion",
             w."providerTime", w."createdAt", w."payload"
      FROM "WebhookEvent" w
      WHERE w."eventType" = 'whatsapp.message.updated'
        AND w."messageId" IS NULL
        AND w."createdAt" >= ${args.since}
        ${typeFilter}
        ${accountFilter}
      ORDER BY COALESCE(w."providerTime", w."createdAt") ASC, w."createdAt" ASC
      LIMIT ${args.limit}
    `;

    logger.log(
      `Found ${rows.length} unmatched whatsapp.message.updated webhooks since=${args.since.toISOString()} type=${args.type} apply=${args.apply}`,
    );

    for (const row of rows) {
      const wm = (row.payload as any)?.whatsappMessage ?? {};
      logger.log(
        `- ${row.providerEventId} ycloudMessageId=${wm.id ?? '-'} type=${wm.type ?? '-'} status=${wm.status ?? '-'} template=${wm.template?.name ?? '-'} createTime=${wm.createTime ?? '-'}`,
      );
    }

    if (!args.apply) {
      logger.log('Dry-run: nada procesado. Añade --apply para reprocesar.');
      return;
    }

    let ok = 0;
    let failed = 0;

    for (const row of rows) {
      const job: WebhookInboxJob = {
        provider: 'ycloud',
        providerEventId: row.providerEventId,
        eventType: row.eventType,
        apiVersion: row.apiVersion,
        providerTime: row.providerTime?.toISOString() ?? null,
        payload: row.payload,
        receivedAt: new Date().toISOString(),
      };

      try {
        await messageStatus.process(job);
        ok += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          `Reprocess failed providerEventId=${row.providerEventId}: ${errorMessage(error)}`,
        );
      }
    }

    const stillUnmatched = await prisma.webhookEvent.count({
      where: {
        providerEventId: { in: rows.map((r) => r.providerEventId) },
        messageId: null,
      },
    });

    logger.log(
      `Done processed=${ok} failed=${failed} stillUnmatched=${stillUnmatched}`,
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
