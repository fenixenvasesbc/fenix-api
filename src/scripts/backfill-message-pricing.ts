// Backfill: recupera totalPrice/currency/pricingCategory para mensajes
// salientes cuyo webhook de costo ya llego pero se perdio (bug corregido en
// message-status.service.ts: el camino "mensaje ya existe" no persistia
// esos campos, solo el camino raro de reconstruccion manual lo hacia).
//
// No vuelve a pedirle nada a YCloud: cada mensaje guarda en rawPayload el
// ultimo webhook que proceso (el bug guardaba el payload completo, solo
// fallaba en extraer esos tres campos), asi que el costo real sigue ahi.
// Este script lee ese JSON y completa lo que falte.
//
// Idempotente: solo toca mensajes con totalPrice actualmente en null.
//
// Uso (por defecto es DRY RUN, no escribe nada):
//   npx ts-node src/scripts/backfill-message-pricing.ts
//   npx ts-node src/scripts/backfill-message-pricing.ts --apply
//   npx ts-node src/scripts/backfill-message-pricing.ts --apply --account=<uuid>
//   npx ts-node src/scripts/backfill-message-pricing.ts --apply --from=2026-08-01 --to=2026-09-01

import 'dotenv/config';
import { MessageDirection, Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type Args = {
  apply: boolean;
  accountId: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
};

type PricingFound = {
  totalPrice: number;
  currency: string | null;
  pricingCategory: string | null;
};

type MessageRow = {
  id: string;
  accountId: string;
  rawPayload: Prisma.JsonValue;
};

type Summary = {
  scanned: number;
  withPriceInPayload: number;
  updated: number;
  noPriceInPayload: number;
};

const DEFAULT_LIMIT = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account')?.trim() || null;
  const fromRaw = readArg(argv, '--from')?.trim() || null;
  const toRaw = readArg(argv, '--to')?.trim() || null;
  const limitRaw = readArg(argv, '--limit');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;

  if (accountId && !UUID_RE.test(accountId)) {
    throw new Error('--account must be a valid UUID');
  }
  if (fromRaw && !DATE_RE.test(fromRaw)) {
    throw new Error('--from must be YYYY-MM-DD');
  }
  if (toRaw && !DATE_RE.test(toRaw)) {
    throw new Error('--to must be YYYY-MM-DD');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('--limit must be an integer between 1 and 5000');
  }

  return {
    apply,
    accountId,
    from: fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null,
    to: toRaw ? new Date(`${toRaw}T00:00:00.000Z`) : null,
    limit,
  };
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

// rawPayload puede ser, segun cual fue la ultima escritura:
//  - el evento de webhook completo: { type, whatsappMessage: { totalPrice, currency, pricingCategory, ... } }
//  - la respuesta cruda de YCloud al enviar (no trae costo, es anterior al webhook)
// Se buscan los campos en ambas formas posibles.
function extractPricing(rawPayload: Prisma.JsonValue): PricingFound | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }

  const root = rawPayload as Record<string, unknown>;
  const nested =
    root.whatsappMessage && typeof root.whatsappMessage === 'object'
      ? (root.whatsappMessage as Record<string, unknown>)
      : null;

  const candidate = nested ?? root;
  const totalPrice = candidate.totalPrice;

  if (typeof totalPrice !== 'number' || !Number.isFinite(totalPrice)) {
    return null;
  }

  return {
    totalPrice,
    currency: nonEmpty(candidate.currency),
    pricingCategory: nonEmpty(candidate.pricingCategory),
  };
}

function printSummary(summary: Summary, apply: boolean) {
  console.log('\n' + '='.repeat(70));
  console.log(`Backfill message pricing summary (mode: ${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log('='.repeat(70));
  console.log(`Mensajes escaneados (totalPrice null)   : ${summary.scanned}`);
  console.log(`Con costo recuperable en rawPayload      : ${summary.withPriceInPayload}`);
  console.log(`Sin costo en rawPayload (sin webhook aun): ${summary.noPriceInPayload}`);
  console.log(`Mensajes ${apply ? 'actualizados' : 'que se actualizarian'}                : ${summary.updated}`);
  console.log('='.repeat(70));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const summary: Summary = {
    scanned: 0,
    withPriceInPayload: 0,
    updated: 0,
    noPriceInPayload: 0,
  };

  console.log(
    `Starting message-pricing backfill mode=${args.apply ? 'APPLY' : 'DRY RUN'} limit=${args.limit}${
      args.accountId ? ` account=${args.accountId}` : ''
    }${args.from ? ` from=${args.from.toISOString()}` : ''}${
      args.to ? ` to=${args.to.toISOString()}` : ''
    }`,
  );

  try {
    let cursor: string | null = null;

    while (true) {
      const rows: MessageRow[] = await prisma.message.findMany({
        where: {
          direction: MessageDirection.OUTBOUND,
          totalPrice: null,
          rawPayload: { not: Prisma.JsonNull },
          ...(args.accountId ? { accountId: args.accountId } : {}),
          ...(args.from || args.to
            ? {
                createdAt: {
                  ...(args.from ? { gte: args.from } : {}),
                  ...(args.to ? { lt: args.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: args.limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, accountId: true, rawPayload: true },
      });

      if (rows.length === 0) break;

      summary.scanned += rows.length;

      for (const row of rows) {
        const pricing = extractPricing(row.rawPayload);

        if (!pricing) {
          summary.noPriceInPayload += 1;
          continue;
        }

        summary.withPriceInPayload += 1;
        summary.updated += 1;

        console.log(
          `  [${args.apply ? 'ACTUALIZAR' : 'DRY-RUN'}] messageId=${row.id} accountId=${row.accountId} totalPrice=${pricing.totalPrice} currency=${pricing.currency ?? '-'} pricingCategory=${pricing.pricingCategory ?? '-'}`,
        );

        if (!args.apply) continue;

        try {
          await prisma.message.update({
            where: { id: row.id },
            data: {
              totalPrice: pricing.totalPrice,
              currency: pricing.currency ?? undefined,
              pricingCategory: pricing.pricingCategory ?? undefined,
            },
          });
        } catch (error) {
          console.error(
            `  [ERROR] no se pudo actualizar messageId=${row.id}: ${errorMessage(error)}`,
          );
        }
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < args.limit) break;
    }
  } finally {
    printSummary(summary, args.apply);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(`Message pricing backfill failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
