// ADR-006: backfill de LeadCampaign.respondedAt/responseMessageId para
// campanas ya enviadas ANTES de que InboundMessageService empezara a
// marcarlas en vivo (commit 17cd907). Sin esto, toda LeadCampaign
// despachada antes del deploy queda con respondedAt=null para siempre,
// aunque el lead haya respondido despues -- el panel de metricas
// (CampaignResponseMetricsPanel) subestima la tasa de respuesta real del
// historico.
//
// Replica la misma regla de atribucion que corre en vivo
// (InboundMessageService.process()): por cada lead, recorre sus inbounds
// en orden cronologico y, por cada uno, resuelve la LeadCampaign SENT sin
// respuesta mas reciente (sentAt <= inboundAt) en ese momento -- nunca la
// mas vieja, para no inflar campanas viejas cuando hubo varias pendientes
// a la vez. Es deliberadamente secuencial por lead (no un UPDATE masivo en
// una sola query): la regla "la mas reciente sin respuesta todavia" es con
// estado (cambia a medida que se van resolviendo), no se puede expresar en
// un solo UPDATE ... FROM sin simular el mismo recorrido.
//
// Importante: si el lead ya tiene campanas resueltas por trafico EN VIVO
// (deployado despues de 17cd907), sus responseMessageId reales se excluyen
// del pool de inbounds antes de simular -- si no, este script podria
// "reclamar" para una campana vieja sin respuesta un mensaje que en la
// realidad ya fue la respuesta de una campana mas nueva (resuelta en vivo).
//
// Uso (dry-run por defecto, no escribe nada):
//   npm run campaigns:backfill-responses
//   npm run campaigns:backfill-responses -- --type=LABEL_RULE
//   npm run campaigns:backfill-responses -- --template-name=recordatorio_presupuesto
//   npm run campaigns:backfill-responses -- --account=<ACCOUNT_UUID>
//   npm run campaigns:backfill-responses -- --since=2026-09-01
//
// Aplicar los cambios:
//   npm run campaigns:backfill-responses -- --template-name=recordatorio_presupuesto --apply
//
// --type / --template-name / --account / --since son todos opcionales y
// combinables; sin ninguno, recorre TODAS las LeadCampaign SENT sin
// respuesta de todas las cuentas (reenganche + repeticion + reglas de
// etiqueta). El dry-run siempre imprime, antes de simular nada, el
// desglose de candidatos por tipo+plantilla -- util para ver que nombre de
// plantilla usar en --template-name si se quiere acotar a una regla
// puntual (ej. la de "recordatorio de presupuesto").

import 'dotenv/config';
import {
  LeadCampaignStatus,
  LeadCampaignType,
  MessageDirection,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Args = {
  apply: boolean;
  accountId: string | null;
  type: LeadCampaignType | null;
  templateName: string | null;
  since: Date | null;
  limit: number | null;
};

type PendingCampaign = {
  id: string;
  leadId: string;
  accountId: string;
  type: LeadCampaignType;
  targetTemplateName: string | null;
  sentAt: Date;
};

type Match = {
  leadCampaignId: string;
  leadId: string;
  accountId: string;
  type: LeadCampaignType;
  templateName: string | null;
  sentAt: Date;
  respondedAt: Date;
  responseMessageId: string;
};

function readArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const accountId = readArg(argv, '--account')?.trim() || null;
  const templateName = readArg(argv, '--template-name')?.trim() || null;
  const typeRaw = readArg(argv, '--type')?.trim();
  const sinceRaw = readArg(argv, '--since')?.trim();
  const limitRaw = readArg(argv, '--limit')?.trim();

  if (accountId && !UUID_RE.test(accountId)) {
    throw new Error('--account must be a valid UUID');
  }

  let type: LeadCampaignType | null = null;
  if (typeRaw) {
    const valid = Object.values(LeadCampaignType) as string[];
    if (!valid.includes(typeRaw)) {
      throw new Error(`--type must be one of: ${valid.join(', ')}`);
    }
    type = typeRaw as LeadCampaignType;
  }

  let since: Date | null = null;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (isNaN(since.getTime())) {
      throw new Error('--since must be a valid date (e.g. 2026-09-01)');
    }
  }

  let limit: number | null = null;
  if (limitRaw) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('--limit must be a positive integer');
    }
  }

  return { apply, accountId, type, templateName, since, limit };
}

async function findPendingCampaigns(
  prisma: PrismaClient,
  args: Args,
): Promise<PendingCampaign[]> {
  const rows = await prisma.leadCampaign.findMany({
    where: {
      status: LeadCampaignStatus.SENT,
      respondedAt: null,
      sentAt: { not: null, ...(args.since ? { gte: args.since } : {}) },
      ...(args.accountId ? { accountId: args.accountId } : {}),
      ...(args.type ? { type: args.type } : {}),
      ...(args.templateName ? { targetTemplateName: args.templateName } : {}),
    },
    orderBy: [{ leadId: 'asc' }, { sentAt: 'asc' }],
    select: {
      id: true,
      leadId: true,
      accountId: true,
      type: true,
      targetTemplateName: true,
      sentAt: true,
    },
  });

  // sentAt esta filtrado como "not: null" arriba, asi que el cast es seguro.
  return rows.map((r) => ({ ...r, sentAt: r.sentAt as Date }));
}

// Mensajes que YA fueron la respuesta registrada de otra LeadCampaign de
// este mismo lead (resuelta por trafico en vivo, o por una corrida previa
// de este mismo script) -- se excluyen del pool antes de simular, para no
// reclamarlos de nuevo para una campana vieja sin respuesta.
async function findAlreadyClaimedMessageIds(
  prisma: PrismaClient,
  leadIds: string[],
): Promise<Map<string, Set<string>>> {
  const rows = await prisma.leadCampaign.findMany({
    where: {
      leadId: { in: leadIds },
      status: LeadCampaignStatus.SENT,
      respondedAt: { not: null },
      responseMessageId: { not: null },
    },
    select: { leadId: true, responseMessageId: true },
  });

  const byLead = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.responseMessageId) continue;
    const set = byLead.get(row.leadId) ?? new Set<string>();
    set.add(row.responseMessageId);
    byLead.set(row.leadId, set);
  }
  return byLead;
}

function printCandidateBreakdown(campaigns: PendingCampaign[]) {
  const byKey = new Map<string, number>();
  for (const c of campaigns) {
    const key = `${c.type} / ${c.targetTemplateName ?? '(sin plantilla)'}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }

  console.log(
    `\nCandidatos (LeadCampaign SENT sin respuesta): ${campaigns.length}`,
  );
  for (const [key, count] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${key}: ${count}`);
  }
}

// Simula, lead por lead, la misma regla que corre en vivo en
// InboundMessageService.process(): por cada inbound (en orden
// cronologico, excluyendo los ya reclamados por otra campana resuelta),
// resuelve la LeadCampaign SENT-sin-respuesta MAS RECIENTE con sentAt <=
// inboundAt, contra el estado que va quedando DESPUES de resolver inbounds
// anteriores del mismo lead -- nunca contra el estado original. Esto es
// necesario porque, si hubo mas de una campana pendiente para el mismo
// lead, cada inbound puede resolver una campana distinta (siempre la mas
// nueva de las que quedan pendientes en ese momento).
async function simulateForLead(
  prisma: PrismaClient,
  leadId: string,
  campaigns: PendingCampaign[], // ya ordenadas por sentAt asc
  alreadyClaimed: Set<string>,
): Promise<Match[]> {
  const earliestSentAt = campaigns[0].sentAt;

  const inbounds = await prisma.message.findMany({
    where: {
      leadId,
      direction: MessageDirection.INBOUND,
      deletedAt: null,
      createdAt: { gte: earliestSentAt },
      ...(alreadyClaimed.size > 0
        ? { id: { notIn: [...alreadyClaimed] } }
        : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      providerSendTime: true,
      providerCreateTime: true,
    },
  });

  const pending = [...campaigns];
  const matches: Match[] = [];

  for (const msg of inbounds) {
    if (pending.length === 0) break;

    const inboundAt = msg.providerSendTime ?? msg.providerCreateTime ?? msg.createdAt;

    let bestIndex = -1;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].sentAt.getTime() <= inboundAt.getTime()) {
        bestIndex = i;
        break;
      }
    }

    if (bestIndex === -1) continue;

    const matched = pending.splice(bestIndex, 1)[0];
    matches.push({
      leadCampaignId: matched.id,
      leadId,
      accountId: matched.accountId,
      type: matched.type,
      templateName: matched.targetTemplateName,
      sentAt: matched.sentAt,
      respondedAt: inboundAt,
      responseMessageId: msg.id,
    });
  }

  return matches;
}

function printMatchSummary(matches: Match[]) {
  const byKey = new Map<
    string,
    { count: number; totalSeconds: number }
  >();

  for (const m of matches) {
    const key = `${m.type} / ${m.templateName ?? '(sin plantilla)'}`;
    const seconds = (m.respondedAt.getTime() - m.sentAt.getTime()) / 1000;
    const entry = byKey.get(key) ?? { count: 0, totalSeconds: 0 };
    entry.count += 1;
    entry.totalSeconds += seconds;
    byKey.set(key, entry);
  }

  console.log(`\nRespuestas encontradas: ${matches.length}`);
  for (const [key, entry] of [...byKey.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const avgMinutes = (entry.totalSeconds / entry.count / 60).toFixed(1);
    console.log(`  - ${key}: ${entry.count} (tiempo de respuesta prom. ${avgMinutes} min)`);
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
    const pendingCampaigns = await findPendingCampaigns(prisma, args);
    printCandidateBreakdown(pendingCampaigns);

    if (pendingCampaigns.length === 0) {
      console.log('\nNada para reconciliar.');
      return;
    }

    const byLead = new Map<string, PendingCampaign[]>();
    for (const c of pendingCampaigns) {
      const list = byLead.get(c.leadId) ?? [];
      list.push(c);
      byLead.set(c.leadId, list);
    }

    let leadIds = [...byLead.keys()];
    if (args.limit) leadIds = leadIds.slice(0, args.limit);

    const claimedByLead = await findAlreadyClaimedMessageIds(prisma, leadIds);

    const allMatches: Match[] = [];
    for (const leadId of leadIds) {
      const campaigns = byLead.get(leadId)!;
      const claimed = claimedByLead.get(leadId) ?? new Set<string>();
      const matches = await simulateForLead(prisma, leadId, campaigns, claimed);
      allMatches.push(...matches);
    }

    printMatchSummary(allMatches);

    if (!args.apply) {
      console.log(
        '\nDry run only (no se escribió nada). Agrega --apply para guardar estas respuestas.',
      );
      return;
    }

    if (allMatches.length === 0) {
      console.log('\nNada para aplicar.');
      return;
    }

    let applied = 0;
    let skippedRace = 0;

    for (const match of allMatches) {
      // Guard de respondedAt: null en el WHERE -- si el trafico en vivo
      // (InboundMessageService) ya resolvio esta misma LeadCampaign entre
      // que se armo este resultado y que se corrio --apply, este update no
      // pisa ese valor real con el calculado retroactivamente aqui.
      const result = await prisma.leadCampaign.updateMany({
        where: { id: match.leadCampaignId, respondedAt: null },
        data: {
          respondedAt: match.respondedAt,
          responseMessageId: match.responseMessageId,
        },
      });

      if (result.count === 1) {
        applied += 1;
      } else {
        skippedRace += 1;
      }
    }

    console.log(`\nAplicadas: ${applied}`);
    if (skippedRace > 0) {
      console.log(
        `Omitidas por carrera con trafico en vivo (ya tenian respondedAt): ${skippedRace}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
