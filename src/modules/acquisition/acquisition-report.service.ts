import { BadRequestException, Injectable } from '@nestjs/common';
import { DesignRequestCountry, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AcquisitionSpendService, valueOn } from './acquisition-spend.service';
import {
  ACQUISITION_TIME_ZONE,
  addDays,
  coarseUtcRange,
  currentWeekStart,
  daysBetween,
  isDateKey,
  isSendDay,
  madridDateKey,
  sendDayOf,
  weekStartOf,
  weeksBetween,
} from './acquisition-week.util';

export const UNASSIGNED_KEY = '__unassigned__';
// Tiempos de conversion: bocetos de leads sin ningun contacto de n8n previo
export const NO_CAMPAIGN_KEY = '__no_campaign__';
const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 104;
const MAX_DAYS = 92;
// Ventana para calcular la madurez (tiempos de conversion historicos)
const MATURITY_LOOKBACK_WEEKS = 26;
const MATURITY_THRESHOLD = 0.8;
const MATURITY_MIN_SAMPLE = 10;
const MATURITY_FALLBACK_WEEKS = 4;
const CURVE_MAX_WEEKS = 12;

export type Granularity = 'week' | 'day';

// Acumulador interno de un periodo (semana martes-lunes o dia de envio).
type Acc = {
  key: string;
  leads: number;
  bocetos: number;
  approved: number;
  quotes: number;
  spendCents: number | null;
  // Objetivo: coste esperado (objetivo vigente el dia de entrada x cada lead)
  targetCostCents: number;
  targetLeads: number;
  // Respaldo sin leads: media de los objetivos diarios vigentes
  targetDaySum: number;
  targetDays: number;
};

// Fila del analisis de tiempos: TODA primera solicitud BOCETO de un lead,
// venga o no de una campaña de n8n (touchAt/familyId null si no).
type TimingRow = {
  leadId: string;
  touchAt: Date | null;
  familyId: string | null;
  firstReplyAt: Date | null;
  bocetoAt: Date;
  approvedAt: Date | null;
};

type AttributedRow = {
  leadId: string;
  touchAt: Date;
  // Primer mensaje entrante del lead entre el toque atribuido y la creacion
  // del boceto (null si no contesto antes de pedirlo).
  firstReplyAt: Date | null;
  bocetoAt: Date;
  approvedAt: Date | null;
  familyId: string | null;
};

/**
 * ADR-007: reporte de ROI por familia, por semana (martes-lunes) o por dia de
 * envio (sab/dom se agregan al lunes).
 *
 * Reglas (confirmadas por el usuario 22-23/nov/2026):
 * - Mensajes: leads distintos con un toque de captacion (envio de n8n) en el
 *   periodo, por la familia de la plantilla de ese envio.
 * - Bocetos: la PRIMERA solicitud BOCETO de cada lead (requestType 'BOCETO'
 *   o null en solicitudes antiguas) se atribuye al ULTIMO toque del lead
 *   anterior a su creacion; cuenta en el periodo y familia de ese toque.
 * - Aprobados: esa misma solicitud con approvedAt no nulo.
 * - Presupuestos: primera asignacion de la etiqueta configurada como
 *   "Presupuesto enviado", atribuida igual (ultimo toque anterior); cuenta en
 *   el periodo de entrada del lead.
 * - Inversion: suma de los importes diarios vigentes de cada dia natural del
 *   periodo (el lunes incluye sabado y domingo).
 * - Objetivo €/mensaje: el vigente el dia de entrada de cada lead (media
 *   ponderada por mensajes); sin mensajes, media de los objetivos diarios.
 * Todo se resuelve al consultar (sin snapshot).
 */
@Injectable()
export class AcquisitionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spend: AcquisitionSpendService,
  ) {}

  // ---------------------------------------------------------------------
  // Reporte por periodo (semana martes-lunes o dia de envio)
  // ---------------------------------------------------------------------

  async getReport(query: {
    granularity?: Granularity;
    from?: string;
    to?: string;
    groupBy?: 'family' | 'country';
  }) {
    const granularity: Granularity = query.granularity ?? 'week';
    const groupBy = query.groupBy ?? 'family';
    const { periods, calendarDays, fromDay, toDay } = this.resolvePeriods(granularity, query.from, query.to);
    const periodOf = (day: string) => (granularity === 'week' ? weekStartOf(day) : sendDayOf(day));
    const periodSet = new Set(periods);
    const range = coarseUtcRange(calendarDays[0], toDay);

    const [families, touchRows, attributedRows, settings, schedules, maturity] = await Promise.all([
      this.prisma.investmentFamily.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, country: true, active: true, sortOrder: true },
      }),
      this.prisma.$queryRaw<{ leadId: string; familyId: string | null; day: Date }[]>(Prisma.sql`
        SELECT DISTINCT t."leadId" AS "leadId",
               l."familyId" AS "familyId",
               ${this.localDateSql(Prisma.sql`t."occurredAt"`)} AS "day"
        FROM "LeadAcquisitionTouch" t
        JOIN "AcquisitionTemplate" l ON l."id" = t."templateId"
        WHERE t."occurredAt" >= ${range.start} AND t."occurredAt" < ${range.end}
      `),
      this.loadAttributed(range.start, range.end),
      this.spend.getSettings(),
      this.spend.loadSchedules(),
      this.computeMaturity(),
    ]);
    const quoteRows = settings.quoteLabelCode
      ? await this.loadQuotes(settings.quoteLabelCode, range.start, range.end)
      : [];

    const cells = new Map<string, Map<string, Acc>>();
    const cell = (familyKey: string, period: string): Acc | null => {
      if (!periodSet.has(period)) return null;
      let perPeriod = cells.get(familyKey);
      if (!perPeriod) {
        perPeriod = new Map();
        cells.set(familyKey, perPeriod);
      }
      let c = perPeriod.get(period);
      if (!c) {
        c = emptyAcc(period);
        perPeriod.set(period, c);
      }
      return c;
    };

    // Mensajes: leads distintos por familia y periodo; el objetivo se toma del
    // primer dia de entrada del lead dentro del periodo.
    const firstDay = new Map<string, Map<string, string>>(); // fam|period -> lead -> dia
    for (const r of touchRows) {
      const day = toKey(r.day);
      const period = periodOf(day);
      if (!periodSet.has(period)) continue;
      const famKey = r.familyId ?? UNASSIGNED_KEY;
      const k = `${famKey}|${period}`;
      const leads = firstDay.get(k) ?? new Map<string, string>();
      const prev = leads.get(r.leadId);
      if (!prev || day < prev) leads.set(r.leadId, day);
      firstDay.set(k, leads);
    }
    for (const [k, leads] of firstDay) {
      const [famKey, period] = k.split('|');
      const c = cell(famKey, period)!;
      c.leads += leads.size;
      if (famKey === UNASSIGNED_KEY) continue;
      for (const day of leads.values()) {
        const t = valueOn(schedules.target.get(famKey), day)?.value ?? null;
        if (t !== null) {
          c.targetCostCents += t;
          c.targetLeads += 1;
        }
      }
    }

    for (const r of attributedRows) {
      const c = cell(r.familyId ?? UNASSIGNED_KEY, periodOf(madridDateKey(r.touchAt)));
      if (c) {
        c.bocetos += 1;
        if (r.approvedAt) c.approved += 1;
      }
    }
    for (const r of quoteRows) {
      const c = cell(r.familyId ?? UNASSIGNED_KEY, periodOf(madridDateKey(r.touchAt)));
      if (c) c.quotes += 1;
    }

    // Inversion diaria (todos los dias naturales) y respaldo del objetivo
    for (const f of families) {
      const rates = schedules.spend.get(f.id);
      const targets = schedules.target.get(f.id);
      if (!rates && !targets) continue;
      for (const day of calendarDays) {
        const period = periodOf(day);
        if (!periodSet.has(period)) continue;
        const amount = valueOn(rates, day)?.value ?? null;
        const target = isSendDay(day) ? valueOn(targets, day)?.value ?? null : null;
        if (amount === null && target === null) continue;
        const c = cell(f.id, period)!;
        if (amount !== null) c.spendCents = (c.spendCents ?? 0) + amount;
        if (target !== null) {
          c.targetDaySum += target;
          c.targetDays += 1;
        }
      }
    }

    type Row = {
      key: string;
      name: string;
      country: DesignRequestCountry | null;
      active: boolean;
      periods: Acc[];
    };
    const filled = (perPeriod?: Map<string, Acc>) => periods.map((p) => perPeriod?.get(p) ?? emptyAcc(p));

    let rows: Row[] = families
      .filter((f) => f.active || cells.has(f.id))
      .map((f) => ({
        key: f.id,
        name: f.name,
        country: f.country,
        active: f.active,
        periods: filled(cells.get(f.id)),
      }));
    if (cells.has(UNASSIGNED_KEY)) {
      rows.push({
        key: UNASSIGNED_KEY,
        name: 'Sin familia asignada',
        country: null,
        active: true,
        periods: filled(cells.get(UNASSIGNED_KEY)),
      });
    }

    if (groupBy === 'country') {
      const byCountry = new Map<string, Row>();
      for (const row of rows) {
        const key = row.country ?? UNASSIGNED_KEY;
        let target = byCountry.get(key);
        if (!target) {
          target = {
            key,
            name: row.country ?? 'Sin familia asignada',
            country: row.country,
            active: true,
            periods: filled(),
          };
          byCountry.set(key, target);
        }
        row.periods.forEach((p, i) => addInto(target!.periods[i], p));
      }
      rows = Array.from(byCountry.values());
    }

    const totals = filled();
    for (const row of rows) row.periods.forEach((p, i) => addInto(totals[i], p));

    const today = madridDateKey(new Date());
    return {
      granularity,
      from: fromDay,
      to: toDay,
      groupBy,
      periods: periods.map((p) => ({
        key: p,
        // el lunes (vista diaria) incluye la inversion de sabado y domingo
        start: granularity === 'week' ? p : addDays(p, -(isMonday(p) ? 2 : 0)),
        end: granularity === 'week' ? addDays(p, 6) : p,
        status: this.periodStatus(granularity, p, today, maturity.weeks),
      })),
      maturity,
      quoteLabel: settings.quoteLabel,
      rows: rows.map((r) => ({
        key: r.key,
        name: r.name,
        country: r.country,
        active: r.active,
        periods: r.periods.map(finalize),
        totals: finalize(sumAcc(r.periods)),
      })),
      totals: { periods: totals.map(finalize), totals: finalize(sumAcc(totals)) },
    };
  }

  // ---------------------------------------------------------------------
  // Analisis de tiempos de conversion
  // ---------------------------------------------------------------------

  /**
   * Tiempos de conversion (pedido del usuario): (1) primera respuesta del
   * lead -> boceto pedido y (2) boceto pedido -> boceto aprobado. NO dependen
   * de la captacion de n8n: se calculan sobre TODA primera solicitud BOCETO
   * de un lead pedida en el rango (semana de creacion del boceto). La curva
   * y la madurez si salen de la cohorte de campañas (necesitan la semana de
   * entrada del lead).
   */
  async getConversionLag(query: { from?: string; to?: string }) {
    const { fromWeek, toWeek } = this.resolveWeekRange(
      query.from,
      query.to,
      MATURITY_LOOKBACK_WEEKS,
    );
    const range = coarseUtcRange(fromWeek, addDays(toWeek, 6));
    const inWeeks = (instant: Date) => {
      const w = this.weekOfInstant(instant);
      return w >= fromWeek && w <= toWeek;
    };

    const [timingRows, attributedRows, families] = await Promise.all([
      this.loadTimings(range.start, range.end),
      this.loadAttributed(range.start, range.end),
      this.prisma.investmentFamily.findMany({ select: { id: true, name: true } }),
    ]);
    const timings = timingRows.filter((r) => inWeeks(r.bocetoAt));
    const cohort = attributedRows.filter((r) => inWeeks(r.touchAt));
    const familyName = new Map(families.map((f) => [f.id, f.name]));

    const cohortSummary = this.lagSummary(cohort);
    const byGroup = new Map<string, TimingRow[]>();
    for (const r of timings) {
      const key = r.touchAt === null ? NO_CAMPAIGN_KEY : r.familyId ?? UNASSIGNED_KEY;
      const list = byGroup.get(key) ?? [];
      list.push(r);
      byGroup.set(key, list);
    }
    const groupName = (key: string) =>
      key === NO_CAMPAIGN_KEY
        ? 'Sin contacto de n8n'
        : key === UNASSIGNED_KEY
          ? 'Sin familia asignada'
          : familyName.get(key) ?? key;

    return {
      from: fromWeek,
      to: toWeek,
      ...this.timingSummary(timings),
      // Cohorte de campañas (semana de entrada): solo para la madurez
      curve: cohortSummary.curve,
      curveSample: cohortSummary.approved,
      maturityWeeks: cohortSummary.maturityWeeks,
      daysEntryToApproval: cohortSummary.daysEntryToApproval,
      maturityThreshold: MATURITY_THRESHOLD,
      byFamily: Array.from(byGroup.entries())
        .map(([key, list]) => ({ key, name: groupName(key), ...this.timingSummary(list) }))
        .sort((a, b) => b.bocetos - a.bocetos),
    };
  }

  private timingSummary(rows: TimingRow[]) {
    const dayMs = 86_400_000;
    const replied = rows.filter((r) => r.firstReplyAt);
    const approved = rows.filter((r) => r.approvedAt);
    return {
      bocetos: rows.length,
      approved: approved.length,
      replied: replied.length,
      daysReplyToBoceto: this.stats(
        replied.map((r) => (r.bocetoAt.getTime() - r.firstReplyAt!.getTime()) / dayMs),
      ),
      daysBocetoToApproval: this.stats(
        approved.map((r) => (r.approvedAt!.getTime() - r.bocetoAt.getTime()) / dayMs),
      ),
    };
  }

  /**
   * Primera solicitud BOCETO de cada lead creada en el rango, con o sin
   * contacto de n8n. Primera respuesta = primer mensaje INBOUND (hora real)
   * anterior al boceto y, si hubo contacto de n8n antes, posterior al ultimo
   * de esos contactos (para no tomar una respuesta de una campaña anterior).
   * Sin contacto de n8n equivale a Lead.firstInboundAt.
   */
  private async loadTimings(start: Date, end: Date): Promise<TimingRow[]> {
    return this.prisma.$queryRaw<TimingRow[]>(Prisma.sql`
      -- acquisition:timings
      WITH first_boceto AS (
        SELECT DISTINCT ON (dr."leadId")
               dr."leadId", dr."createdAt", dr."approvedAt"
        FROM "DesignRequest" dr
        WHERE dr."requestType" IS NULL OR dr."requestType" = 'BOCETO'
        ORDER BY dr."leadId", dr."createdAt" ASC
      )
      SELECT fb."leadId",
             t."occurredAt" AS "touchAt",
             l."familyId" AS "familyId",
             (
               SELECT MIN(m."occurredAt")
               FROM "Message" m
               WHERE m."leadId" = fb."leadId"
                 AND m."direction" = 'INBOUND'
                 AND m."occurredAt" <= fb."createdAt"
                 AND (t."occurredAt" IS NULL OR m."occurredAt" >= t."occurredAt")
             ) AS "firstReplyAt",
             fb."createdAt" AS "bocetoAt",
             fb."approvedAt" AS "approvedAt"
      FROM first_boceto fb
      LEFT JOIN LATERAL (
        SELECT t2."occurredAt", t2."templateId"
        FROM "LeadAcquisitionTouch" t2
        WHERE t2."leadId" = fb."leadId" AND t2."occurredAt" <= fb."createdAt"
        ORDER BY t2."occurredAt" DESC
        LIMIT 1
      ) t ON TRUE
      LEFT JOIN "AcquisitionTemplate" l ON l."id" = t."templateId"
      WHERE fb."createdAt" >= ${start} AND fb."createdAt" < ${end}
    `);
  }


  /** Semanas que hacen falta para que una semana se considere madura. */
  async computeMaturity() {
    const toWeek = currentWeekStart();
    const fromWeek = addDays(toWeek, -7 * MATURITY_LOOKBACK_WEEKS);
    const range = coarseUtcRange(fromWeek, addDays(toWeek, 6));
    const rows = await this.loadAttributed(range.start, range.end);
    const s = this.lagSummary(rows);
    const estimated = s.approved < MATURITY_MIN_SAMPLE || s.maturityWeeks === null;
    return {
      weeks: estimated ? MATURITY_FALLBACK_WEEKS : (s.maturityWeeks as number),
      threshold: MATURITY_THRESHOLD,
      sampleSize: s.approved,
      estimated,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private lagSummary(rows: AttributedRow[]) {
    const dayMs = 86_400_000;
    // Tramo 1 (pedido del usuario): primera respuesta del lead -> boceto pedido.
    const repliedRows = rows.filter((r) => r.firstReplyAt);
    const replyToBoceto = repliedRows.map(
      (r) => (r.bocetoAt.getTime() - r.firstReplyAt!.getTime()) / dayMs,
    );
    const approvedRows = rows.filter((r) => r.approvedAt);
    const bocetoToApproval = approvedRows.map(
      (r) => (r.approvedAt!.getTime() - r.bocetoAt.getTime()) / dayMs,
    );
    const entryToApproval = approvedRows.map(
      (r) => (r.approvedAt!.getTime() - r.touchAt.getTime()) / dayMs,
    );

    // Curva acumulada: % de las aprobaciones que llegan dentro de la
    // semana k desde la entrada del lead.
    const curve: { week: number; cumulativeShare: number }[] = [];
    let maturityWeeks: number | null = null;
    if (entryToApproval.length) {
      for (let k = 0; k <= CURVE_MAX_WEEKS; k += 1) {
        const within = entryToApproval.filter((d) => d < (k + 1) * 7).length;
        const share = within / entryToApproval.length;
        curve.push({ week: k, cumulativeShare: Math.round(share * 1000) / 1000 });
        if (maturityWeeks === null && share >= MATURITY_THRESHOLD) maturityWeeks = k + 1;
      }
    }

    return {
      bocetos: rows.length,
      approved: approvedRows.length,
      // bocetos con una respuesta del lead registrada antes de pedirlo
      replied: repliedRows.length,
      daysReplyToBoceto: this.stats(replyToBoceto),
      // Tramo 2: boceto pedido -> boceto aprobado.
      daysBocetoToApproval: this.stats(bocetoToApproval),
      // Solo para la madurez de la cohorte (semana de entrada del lead).
      daysEntryToApproval: this.stats(entryToApproval),
      curve,
      maturityWeeks,
    };
  }

  /** Media y percentiles (nearest-rank), en dias con 1 decimal. */
  private stats(values: number[]) {
    if (!values.length) return { mean: null, p50: null, p80: null, p90: null };
    const round = (n: number) => Math.round(n * 10) / 10;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p: number) => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
      return round(sorted[idx]);
    };
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
    return { mean: round(mean), p50: at(0.5), p80: at(0.8), p90: at(0.9) };
  }

  private async loadAttributed(start: Date, end: Date): Promise<AttributedRow[]> {
    return this.prisma.$queryRaw<AttributedRow[]>(Prisma.sql`
      ${this.attributedCteSql(start, end)}
      SELECT a."leadId", a."touchAt", a."firstReplyAt", a."bocetoAt", a."approvedAt", a."familyId"
      FROM attributed a
    `);
  }

  /**
   * CTE "attributed": primera solicitud BOCETO de cada lead + ultimo toque de
   * captacion anterior a ella (LATERAL), con la familia actual de la plantilla y
   * la primera respuesta del lead (mensaje INBOUND, hora real `occurredAt`)
   * entre ese toque y la creacion del boceto.
   * Filtra por el instante del toque (rango holgado; el bucket exacto lo
   * aplica quien consume).
   */
  private attributedCteSql(start: Date, end: Date) {
    return Prisma.sql`
      WITH first_boceto AS (
        SELECT DISTINCT ON (dr."leadId")
               dr."leadId", dr."createdAt", dr."approvedAt"
        FROM "DesignRequest" dr
        WHERE dr."requestType" IS NULL OR dr."requestType" = 'BOCETO'
        ORDER BY dr."leadId", dr."createdAt" ASC
      ),
      attributed AS (
        SELECT fb."leadId",
               t."occurredAt" AS "touchAt",
               (
                 SELECT MIN(m."occurredAt")
                 FROM "Message" m
                 WHERE m."leadId" = fb."leadId"
                   AND m."direction" = 'INBOUND'
                   AND m."occurredAt" >= t."occurredAt"
                   AND m."occurredAt" <= fb."createdAt"
               ) AS "firstReplyAt",
               fb."createdAt" AS "bocetoAt",
               fb."approvedAt" AS "approvedAt",
               l."familyId" AS "familyId"
        FROM first_boceto fb
        JOIN LATERAL (
          SELECT t2."occurredAt", t2."templateId"
          FROM "LeadAcquisitionTouch" t2
          WHERE t2."leadId" = fb."leadId" AND t2."occurredAt" <= fb."createdAt"
          ORDER BY t2."occurredAt" DESC
          LIMIT 1
        ) t ON TRUE
        JOIN "AcquisitionTemplate" l ON l."id" = t."templateId"
        WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
      )
    `;
  }

  /**
   * Primera asignacion de la etiqueta de presupuesto de cada lead, atribuida
   * al ultimo toque de captacion anterior a ella (mismo criterio que bocetos).
   */
  private async loadQuotes(labelCode: string, start: Date, end: Date) {
    return this.prisma.$queryRaw<{ leadId: string; touchAt: Date; familyId: string | null }[]>(Prisma.sql`
      -- acquisition:quotes
      WITH first_quote AS (
        SELECT a."leadId", MIN(a."assignedAt") AS "quotedAt"
        FROM "LeadLabelAssignment" a
        WHERE a."label" = ${labelCode}
        GROUP BY a."leadId"
      )
      SELECT fq."leadId", t."occurredAt" AS "touchAt", l."familyId" AS "familyId"
      FROM first_quote fq
      JOIN LATERAL (
        SELECT t2."occurredAt", t2."templateId"
        FROM "LeadAcquisitionTouch" t2
        WHERE t2."leadId" = fq."leadId" AND t2."occurredAt" <= fq."quotedAt"
        ORDER BY t2."occurredAt" DESC
        LIMIT 1
      ) t ON TRUE
      JOIN "AcquisitionTemplate" l ON l."id" = t."templateId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
    `);
  }

  /** Fecha local (Europe/Madrid) de un timestamp guardado en UTC. */
  private localDateSql(column: Prisma.Sql) {
    return Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${ACQUISITION_TIME_ZONE})::date`;
  }

  private weekOfInstant(instant: Date): string {
    return weekStartOf(madridDateKey(instant));
  }

  private resolvePeriods(granularity: Granularity, from?: string, to?: string) {
    if (from && !isDateKey(from)) throw new BadRequestException('from no es una fecha válida');
    if (to && !isDateKey(to)) throw new BadRequestException('to no es una fecha válida');
    if (granularity === 'week') {
      const { fromWeek, toWeek } = this.resolveWeekRange(from, to);
      const periods = weeksBetween(fromWeek, toWeek);
      const toDay = addDays(toWeek, 6);
      return { periods, fromDay: fromWeek, toDay, calendarDays: daysBetween(fromWeek, toDay) };
    }
    const fromDay = from ?? currentWeekStart();
    const toDay = to ?? addDays(fromDay, 6);
    if (fromDay > toDay) throw new BadRequestException('from debe ser anterior a to');
    const all = daysBetween(fromDay, toDay);
    if (all.length > MAX_DAYS) throw new BadRequestException(`El rango no puede superar ${MAX_DAYS} días`);
    const periods = all.filter(isSendDay);
    // sab/dom anteriores a un lunes del rango suman a ese lunes
    const calendarDays = daysBetween(addDays(fromDay, -2), toDay);
    return { periods, fromDay, toDay, calendarDays };
  }

  private resolveWeekRange(from?: string, to?: string, defaultWeeks = DEFAULT_WEEKS) {
    if (from && !isDateKey(from)) throw new BadRequestException('from no es una fecha válida');
    if (to && !isDateKey(to)) throw new BadRequestException('to no es una fecha válida');
    const toWeek = to ? weekStartOf(to) : currentWeekStart();
    const fromWeek = from ? weekStartOf(from) : addDays(toWeek, -7 * (defaultWeeks - 1));
    if (fromWeek > toWeek) throw new BadRequestException('from debe ser anterior a to');
    if (weeksBetween(fromWeek, toWeek).length > MAX_WEEKS) {
      throw new BadRequestException(`El rango no puede superar ${MAX_WEEKS} semanas`);
    }
    return { fromWeek, toWeek };
  }

  /**
   * CURRENT: periodo en curso (o futuro). IN_PROGRESS: cerrado pero todavia
   * pueden llegar aprobaciones. MATURE: ya pasaron `maturityWeeks` semanas.
   */
  private periodStatus(granularity: Granularity, period: string, today: string, maturityWeeks: number) {
    const current = granularity === 'week' ? weekStartOf(today) : sendDayOf(today);
    if (period >= current) return 'CURRENT' as const;
    const reference = granularity === 'week' ? current : today;
    return addDays(period, 7 * maturityWeeks) <= reference ? ('MATURE' as const) : ('IN_PROGRESS' as const);
  }
}

function emptyAcc(key: string): Acc {
  return {
    key,
    leads: 0,
    bocetos: 0,
    approved: 0,
    quotes: 0,
    spendCents: null,
    targetCostCents: 0,
    targetLeads: 0,
    targetDaySum: 0,
    targetDays: 0,
  };
}

function addInto(target: Acc, source: Acc) {
  target.leads += source.leads;
  target.bocetos += source.bocetos;
  target.approved += source.approved;
  target.quotes += source.quotes;
  if (source.spendCents !== null) target.spendCents = (target.spendCents ?? 0) + source.spendCents;
  target.targetCostCents += source.targetCostCents;
  target.targetLeads += source.targetLeads;
  target.targetDaySum += source.targetDaySum;
  target.targetDays += source.targetDays;
}

function sumAcc(list: Acc[]): Acc {
  const total = emptyAcc('total');
  for (const item of list) addInto(total, item);
  return total;
}

/** Celda publica: objetivo de €/mensaje ya resuelto (en centimos). */
function finalize(acc: Acc) {
  const targetCentsPerLead =
    acc.targetLeads > 0
      ? Math.round(acc.targetCostCents / acc.targetLeads)
      : acc.targetDays > 0
        ? Math.round(acc.targetDaySum / acc.targetDays)
        : null;
  return {
    key: acc.key,
    leads: acc.leads,
    bocetos: acc.bocetos,
    approved: acc.approved,
    quotes: acc.quotes,
    spendCents: acc.spendCents,
    targetCentsPerLead,
  };
}

function isMonday(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
}

function toKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
