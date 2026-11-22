import { BadRequestException, Injectable } from '@nestjs/common';
import { DesignRequestCountry, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACQUISITION_TIME_ZONE,
  addDays,
  coarseUtcRange,
  currentWeekStart,
  isDateKey,
  mondayOf,
  weeksBetween,
} from './acquisition-week.util';

export const UNASSIGNED_KEY = '__unassigned__';
// Tiempos de conversion: bocetos de leads sin ningun contacto de n8n previo
export const NO_CAMPAIGN_KEY = '__no_campaign__';
const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 104;
// Ventana para calcular la madurez (tiempos de conversion historicos)
const MATURITY_LOOKBACK_WEEKS = 26;
const MATURITY_THRESHOLD = 0.8;
const MATURITY_MIN_SAMPLE = 10;
const MATURITY_FALLBACK_WEEKS = 4;
const CURVE_MAX_WEEKS = 12;

type WeekCell = {
  weekStart: string;
  leads: number;
  bocetos: number;
  approved: number;
  spendCents: number | null;
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
 * ADR-007: inversion semanal y reportes de ROI por familia.
 *
 * Reglas (confirmadas por el usuario 22/nov/2026):
 * - Leads: leads distintos con un toque de captacion (envio de n8n)
 *   en la semana, por la familia de la plantilla de ese envio.
 * - Bocetos: la PRIMERA solicitud BOCETO de cada lead (requestType 'BOCETO'
 *   o null en solicitudes antiguas) se atribuye al ULTIMO toque del lead
 *   anterior a su creacion; cuenta en la semana y familia de ese toque.
 * - Aprobados: esa misma solicitud con approvedAt no nulo (aunque tenga
 *   varias categorias).
 * Todo se resuelve al consultar (sin snapshot): reasignar plantillas,
 * borrar solicitudes o cambiar su tipo se refleja solo.
 */
@Injectable()
export class AcquisitionReportService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Inversion semanal
  // ---------------------------------------------------------------------

  async getWeeklySpend(weekStartRaw: string) {
    const weekStart = this.requireMonday(weekStartRaw);
    const [families, spends] = await Promise.all([
      this.prisma.investmentFamily.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, country: true },
      }),
      this.prisma.familyWeeklySpend.findMany({
        where: { weekStart: new Date(`${weekStart}T00:00:00Z`) },
        select: { familyId: true, amountCents: true },
      }),
    ]);
    const byFamily = new Map(spends.map((s) => [s.familyId, s.amountCents]));
    return {
      weekStart,
      items: families.map((f) => ({
        familyId: f.id,
        name: f.name,
        country: f.country,
        amountCents: byFamily.get(f.id) ?? null,
      })),
    };
  }

  async upsertWeeklySpend(
    weekStartRaw: string,
    items: { familyId: string; amountCents?: number | null }[],
    userId: string,
  ) {
    const weekStart = this.requireMonday(weekStartRaw);
    const weekDate = new Date(`${weekStart}T00:00:00Z`);

    const familyIds = Array.from(new Set(items.map((i) => i.familyId)));
    const existing = await this.prisma.investmentFamily.count({
      where: { id: { in: familyIds } },
    });
    if (existing !== familyIds.length) {
      throw new BadRequestException('Alguna familia no existe');
    }

    await this.prisma.$transaction(
      items.map((item) =>
        item.amountCents === null || item.amountCents === undefined
          ? this.prisma.familyWeeklySpend.deleteMany({
              where: { familyId: item.familyId, weekStart: weekDate },
            })
          : this.prisma.familyWeeklySpend.upsert({
              where: {
                familyId_weekStart: { familyId: item.familyId, weekStart: weekDate },
              },
              create: {
                familyId: item.familyId,
                weekStart: weekDate,
                amountCents: item.amountCents,
                updatedByUserId: userId,
              },
              update: { amountCents: item.amountCents, updatedByUserId: userId },
            }),
      ),
    );

    return this.getWeeklySpend(weekStart);
  }

  // ---------------------------------------------------------------------
  // Reporte semanal por familia / pais
  // ---------------------------------------------------------------------

  async getWeeklyReport(query: { from?: string; to?: string; groupBy?: 'family' | 'country' }) {
    const { fromWeek, toWeek } = this.resolveWeekRange(query.from, query.to);
    const weeks = weeksBetween(fromWeek, toWeek);
    const range = coarseUtcRange(fromWeek, toWeek);
    const groupBy = query.groupBy ?? 'family';

    const [families, leadRows, bocetoRows, spendRows, maturity] = await Promise.all([
      this.prisma.investmentFamily.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, country: true, active: true, sortOrder: true },
      }),
      this.prisma.$queryRaw<{ week: Date; familyId: string | null; leads: number }[]>(Prisma.sql`
        SELECT ${this.weekBucketSql(Prisma.sql`t."occurredAt"`)} AS "week",
               l."familyId" AS "familyId",
               COUNT(DISTINCT t."leadId")::int AS "leads"
        FROM "LeadAcquisitionTouch" t
        JOIN "AcquisitionTemplate" l ON l."id" = t."templateId"
        WHERE t."occurredAt" >= ${range.start} AND t."occurredAt" < ${range.end}
        GROUP BY 1, 2
      `),
      this.prisma.$queryRaw<
        { week: Date; familyId: string | null; bocetos: number; approved: number }[]
      >(Prisma.sql`
        ${this.attributedCteSql(range.start, range.end)}
        SELECT ${this.weekBucketSql(Prisma.sql`a."touchAt"`)} AS "week",
               a."familyId" AS "familyId",
               COUNT(*)::int AS "bocetos",
               COUNT(a."approvedAt")::int AS "approved"
        FROM attributed a
        GROUP BY 1, 2
      `),
      this.prisma.familyWeeklySpend.findMany({
        where: {
          weekStart: {
            gte: new Date(`${fromWeek}T00:00:00Z`),
            lte: new Date(`${toWeek}T00:00:00Z`),
          },
        },
        select: { familyId: true, weekStart: true, amountCents: true },
      }),
      this.computeMaturity(),
    ]);

    const weekSet = new Set(weeks);

    // Acumulador por familia (o UNASSIGNED_KEY)
    const cells = new Map<string, Map<string, WeekCell>>();
    const cell = (familyKey: string, week: string): WeekCell | null => {
      if (!weekSet.has(week)) return null;
      let perWeek = cells.get(familyKey);
      if (!perWeek) {
        perWeek = new Map();
        cells.set(familyKey, perWeek);
      }
      let c = perWeek.get(week);
      if (!c) {
        c = { weekStart: week, leads: 0, bocetos: 0, approved: 0, spendCents: null };
        perWeek.set(week, c);
      }
      return c;
    };

    for (const r of leadRows) {
      const c = cell(r.familyId ?? UNASSIGNED_KEY, this.dateKey(r.week));
      if (c) c.leads += r.leads;
    }
    for (const r of bocetoRows) {
      const c = cell(r.familyId ?? UNASSIGNED_KEY, this.dateKey(r.week));
      if (c) {
        c.bocetos += r.bocetos;
        c.approved += r.approved;
      }
    }
    for (const s of spendRows) {
      const c = cell(s.familyId, this.dateKey(s.weekStart));
      if (c) c.spendCents = (c.spendCents ?? 0) + s.amountCents;
    }

    // Filas: familias activas siempre; inactivas solo si tienen datos; y
    // "Sin familia" solo si tiene datos.
    type Row = {
      key: string;
      name: string;
      country: DesignRequestCountry | null;
      active: boolean;
      weeks: WeekCell[];
    };
    const emptyWeeks = (perWeek?: Map<string, WeekCell>) =>
      weeks.map(
        (w) =>
          perWeek?.get(w) ?? { weekStart: w, leads: 0, bocetos: 0, approved: 0, spendCents: null },
      );

    let rows: Row[] = families
      .filter((f) => f.active || cells.has(f.id))
      .map((f) => ({
        key: f.id,
        name: f.name,
        country: f.country,
        active: f.active,
        weeks: emptyWeeks(cells.get(f.id)),
      }));
    if (cells.has(UNASSIGNED_KEY)) {
      rows.push({
        key: UNASSIGNED_KEY,
        name: 'Sin familia asignada',
        country: null,
        active: true,
        weeks: emptyWeeks(cells.get(UNASSIGNED_KEY)),
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
            weeks: emptyWeeks(),
          };
          byCountry.set(key, target);
        }
        row.weeks.forEach((w, i) => this.addInto(target!.weeks[i], w));
      }
      rows = Array.from(byCountry.values());
    }

    const totals = emptyWeeks();
    for (const row of rows) row.weeks.forEach((w, i) => this.addInto(totals[i], w));

    const thisWeek = currentWeekStart();
    const weekStatus = weeks.map((w) => ({
      weekStart: w,
      status: this.weekStatus(w, thisWeek, maturity.weeks),
    }));

    return {
      from: fromWeek,
      to: toWeek,
      groupBy,
      weeks: weekStatus,
      maturity,
      rows: rows.map((r) => ({ ...r, totals: this.sumWeeks(r.weeks) })),
      totals: { weeks: totals, totals: this.sumWeeks(totals) },
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
    const range = coarseUtcRange(fromWeek, toWeek);
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
    const range = coarseUtcRange(fromWeek, toWeek);
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

  /** Lunes local (Europe/Madrid) del instante, como date. */
  private weekBucketSql(column: Prisma.Sql) {
    return Prisma.sql`(date_trunc('week', (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${ACQUISITION_TIME_ZONE}))::date`;
  }

  private weekOfInstant(instant: Date): string {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: ACQUISITION_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    return mondayOf(local);
  }

  private dateKey(value: Date | string): string {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  }

  private resolveWeekRange(from?: string, to?: string, defaultWeeks = DEFAULT_WEEKS) {
    if (from && !isDateKey(from)) throw new BadRequestException('from no es una fecha válida');
    if (to && !isDateKey(to)) throw new BadRequestException('to no es una fecha válida');
    const toWeek = to ? mondayOf(to) : currentWeekStart();
    const fromWeek = from ? mondayOf(from) : addDays(toWeek, -7 * (defaultWeeks - 1));
    if (fromWeek > toWeek) throw new BadRequestException('from debe ser anterior a to');
    if (weeksBetween(fromWeek, toWeek).length > MAX_WEEKS) {
      throw new BadRequestException(`El rango no puede superar ${MAX_WEEKS} semanas`);
    }
    return { fromWeek, toWeek };
  }

  private requireMonday(value: string): string {
    if (!isDateKey(value)) throw new BadRequestException('weekStart no es una fecha válida');
    return mondayOf(value);
  }

  /**
   * CURRENT: semana en curso. IN_PROGRESS: cerrada pero todavia pueden
   * llegar aprobaciones. MATURE: ya pasaron `maturityWeeks` semanas.
   */
  private weekStatus(week: string, thisWeek: string, maturityWeeks: number) {
    if (week >= thisWeek) return 'CURRENT' as const;
    return addDays(week, 7 * maturityWeeks) <= thisWeek ? ('MATURE' as const) : ('IN_PROGRESS' as const);
  }

  private addInto(target: WeekCell, source: WeekCell) {
    target.leads += source.leads;
    target.bocetos += source.bocetos;
    target.approved += source.approved;
    if (source.spendCents !== null) target.spendCents = (target.spendCents ?? 0) + source.spendCents;
  }

  private sumWeeks(weeks: WeekCell[]) {
    const total = { leads: 0, bocetos: 0, approved: 0, spendCents: null as number | null };
    for (const w of weeks) {
      total.leads += w.leads;
      total.bocetos += w.bocetos;
      total.approved += w.approved;
      if (w.spendCents !== null) total.spendCents = (total.spendCents ?? 0) + w.spendCents;
    }
    return total;
  }
}
